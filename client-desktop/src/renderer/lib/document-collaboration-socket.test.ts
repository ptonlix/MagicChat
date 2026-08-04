import { afterEach, describe, expect, it, vi } from "vitest"

import type { DocumentCollaborationEvent } from "@shared/document-collaboration-contract"
import { DOCUMENT_COLLABORATION_LIMITS } from "@shared/document-collaboration-contract"
import {
  DocumentCollaborationProviderWebsocket,
  DocumentCollaborationSocket,
} from "./document-collaboration-socket"

const target = { id: "server-1", normalizedUrl: "https://chat.example.com", userId: "user-1" }
const documentId = "550e8400-e29b-41d4-a716-446655440000"
const sessionId = "550e8400-e29b-41d4-a716-446655440000"
const connectionId = "650e8400-e29b-41d4-a716-446655440000"

let listener: ((event: DocumentCollaborationEvent) => void) | undefined
const cancel = vi.fn(async () => undefined)
const close = vi.fn(async () => undefined)
const send = vi.fn(async () => undefined)
let connectMock: ReturnType<typeof vi.fn>

afterEach(() => {
  listener = undefined
  cancel.mockClear()
  close.mockClear()
  send.mockClear()
  connectMock?.mockClear()
  vi.restoreAllMocks()
})

describe("DocumentCollaborationSocket", () => {
  it("权限撤销关闭不会安排 Hocuspocus 自动重连", async () => {
    vi.useFakeTimers()
    const provider = new DocumentCollaborationProviderWebsocket({
      autoConnect: false,
      url: "desktop://document-collaboration",
    })
    const connect = vi.spyOn(provider, "connect").mockResolvedValue(undefined)
    provider.shouldConnect = true

    provider.onClose({ event: new CloseEvent("close", { code: 4403 }) })
    await vi.advanceTimersByTimeAsync(2_000)

    expect(connect).not.toHaveBeenCalled()
    provider.destroy()
    vi.useRealTimers()
  })

  it("按 open/message/close 顺序转换事件并复制 ArrayBuffer", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(connectionId)
    installBridge()
    const socket = new DocumentCollaborationSocket("ignored", target, documentId)
    const events: string[] = []
    let message: ArrayBuffer | undefined
    socket.addEventListener("open", () => events.push("open"))
    socket.addEventListener("message", (event) => {
      events.push("message")
      message = (event as MessageEvent<ArrayBuffer>).data
    })
    socket.addEventListener("close", () => events.push("close"))
    await Promise.resolve()
    expect(connectMock).toHaveBeenCalledWith(target, documentId, connectionId)
    listener?.({ connectionId, sessionId, type: "open" })
    listener?.({ connectionId, data: Uint8Array.of(1, 2), sessionId, type: "message" })
    listener?.({ code: 1000, connectionId, reason: "closed", sessionId, type: "close" })
    expect(events).toEqual(["open", "message", "close"])
    expect([...new Uint8Array(message ?? new ArrayBuffer(0))]).toEqual([1, 2])
  })

  it("连接完成前 close 会取消 pending 并关闭随后返回的 session", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(connectionId)
    let resolveConnect: ((value: { sessionId: string }) => void) | undefined
    installBridge(
      new Promise((resolve) => {
        resolveConnect = resolve
      }),
    )
    const socket = new DocumentCollaborationSocket("ignored", target, documentId)
    socket.close()
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledWith(connectionId)
    resolveConnect?.({ sessionId })
    await Promise.resolve()
    expect(close).toHaveBeenCalledWith(sessionId)
  })

  it("取消 pending 的 IPC 失败时仍正常关闭且不拒绝 Promise", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(connectionId)
    installBridge(new Promise(() => undefined))
    cancel.mockRejectedValueOnce(new Error("ipc unavailable"))
    const socket = new DocumentCollaborationSocket("ignored", target, documentId)
    const closed = vi.fn()
    socket.addEventListener("close", closed)

    socket.close()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    expect(socket.readyState).toBe(DocumentCollaborationSocket.CLOSED)
  })

  it("关闭已建立 session 的 IPC 失败时仍正常关闭", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(connectionId)
    installBridge()
    const socket = new DocumentCollaborationSocket("ignored", target, documentId)
    await Promise.resolve()
    listener?.({ connectionId, sessionId, type: "open" })
    close.mockRejectedValueOnce(new Error("ipc unavailable"))
    const closed = vi.fn()
    socket.addEventListener("close", closed)

    socket.close()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    expect(socket.readyState).toBe(DocumentCollaborationSocket.CLOSED)
  })

  it("只发送二进制并丢弃其他 session 的陈旧事件", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(connectionId)
    installBridge()
    const socket = new DocumentCollaborationSocket("ignored", target, documentId)
    const opened = vi.fn()
    socket.addEventListener("open", opened)
    await Promise.resolve()
    listener?.({
      connectionId,
      sessionId: "750e8400-e29b-41d4-a716-446655440000",
      type: "open",
    })
    listener?.({ connectionId, sessionId, type: "open" })
    socket.send(Uint8Array.of(1, 2))
    expect(opened).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(sessionId, Uint8Array.of(1, 2))
    expect(() => socket.send("text")).toThrow()
  })

  it("对象监听器可以幂等注册并准确移除", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(connectionId)
    installBridge()
    const socket = new DocumentCollaborationSocket("ignored", target, documentId)
    const objectListener = { handleEvent: vi.fn() }
    socket.addEventListener("open", objectListener)
    socket.addEventListener("open", objectListener)
    await Promise.resolve()

    listener?.({ connectionId, sessionId, type: "open" })
    expect(objectListener.handleEvent).toHaveBeenCalledOnce()

    socket.removeEventListener("open", objectListener)
    listener?.({ connectionId, sessionId, type: "open" })
    expect(objectListener.handleEvent).toHaveBeenCalledOnce()
  })

  it("连接完成前忽略其他连接的大帧，只缓存当前连接事件", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(connectionId)
    let resolveConnect: ((value: { sessionId: string }) => void) | undefined
    installBridge(
      new Promise((resolve) => {
        resolveConnect = resolve
      }),
    )
    const socket = new DocumentCollaborationSocket("ignored", target, documentId)
    const opened = vi.fn()
    socket.addEventListener("open", opened)

    listener?.({
      connectionId: "750e8400-e29b-41d4-a716-446655440000",
      data: new Uint8Array(DOCUMENT_COLLABORATION_LIMITS.maxQueueBytes + 1),
      sessionId: "850e8400-e29b-41d4-a716-446655440000",
      type: "message",
    })
    listener?.({ connectionId, sessionId, type: "open" })
    resolveConnect?.({ sessionId })
    await Promise.resolve()
    expect(opened).toHaveBeenCalledOnce()
    expect(socket.readyState).toBe(DocumentCollaborationSocket.OPEN)
    expect(close).not.toHaveBeenCalled()
  })
})

function installBridge(connectPromise = Promise.resolve({ sessionId })) {
  connectMock = vi.fn(() => connectPromise)
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: {
      documentCollaboration: {
        cancel,
        close,
        connect: connectMock,
        send,
        subscribe: vi.fn((next) => {
          listener = next
          return () => {
            listener = undefined
          }
        }),
      },
    },
  })
}
