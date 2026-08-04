// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class FakeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 3

    bufferedAmount = 0
    closeCalls: Array<[number, string]> = []
    readyState = FakeWebSocket.CONNECTING
    readonly sent: Buffer[] = []
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()

    constructor(
      readonly url: URL,
      readonly options: {
        ca?: Buffer[]
        handshakeTimeout?: number
        headers?: Record<string, string>
        maxPayload?: number
        perMessageDeflate?: boolean
        rejectUnauthorized?: boolean
      },
    ) {
      sockets.push(this)
    }

    close(code: number, reason: string) {
      this.closeCalls.push([code, reason])
      this.readyState = FakeWebSocket.CLOSED
    }

    emit(name: string, ...args: unknown[]) {
      const listeners = this.listeners.get(name)
      if (name === "error" && !listeners?.length) {
        throw args[0] instanceof Error ? args[0] : new Error("未处理的 WebSocket 错误")
      }
      listeners?.forEach((listener) => listener(...args))
    }

    hasListeners(name: string) {
      return (this.listeners.get(name)?.length ?? 0) > 0
    }

    on(name: string, listener: (...args: never[]) => void) {
      const listeners = this.listeners.get(name) ?? []
      listeners.push(listener as (...args: unknown[]) => void)
      this.listeners.set(name, listeners)
      return this
    }

    once(name: string, listener: (...args: never[]) => void) {
      const callback = (...args: unknown[]) => {
        const listeners = this.listeners.get(name) ?? []
        this.listeners.set(
          name,
          listeners.filter((value) => value !== callback),
        )
        listener(...(args as never[]))
      }
      return this.on(name, callback as (...args: never[]) => void)
    }

    removeAllListeners() {
      this.listeners.clear()
    }

    send(value: Buffer) {
      this.sent.push(Buffer.from(value))
    }
  }

  const sockets: FakeWebSocket[] = []
  return { FakeWebSocket, resolveProxy: vi.fn(), sockets }
})

vi.mock("ws", () => ({ default: mocks.FakeWebSocket }))
vi.mock("https-proxy-agent", () => ({ HttpsProxyAgent: class {} }))
vi.mock("@main/realtime-controller", () => ({
  resolveProxy: mocks.resolveProxy,
  systemCertificateAuthorities: () => [Buffer.from("ca")],
  withProxyCredentials: (url: string) => url,
}))

import {
  buildDocumentCollaborationUrl,
  DocumentCollaborationController,
  frameMatchesDocument,
} from "./document-collaboration-controller"
import type { ServerProfiles } from "./server-profiles"
import type { SessionController } from "./session-controller"
import type { AuthenticatedTarget } from "@shared/client-contract"
import { DOCUMENT_COLLABORATION_LIMITS } from "@shared/document-collaboration-contract"

const documentId = "550e8400-e29b-41d4-a716-446655440000"
const connectionId = "650e8400-e29b-41d4-a716-446655440000"
const target: AuthenticatedTarget = {
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
  userId: "user-1",
}

describe("文档协作 Main Controller", () => {
  beforeEach(() => {
    mocks.sockets.length = 0
    mocks.resolveProxy.mockReset().mockResolvedValue(null)
    vi.useRealTimers()
  })

  it("只连接固定 WSS 路径，并持有 Cookie、Origin 与 TLS 配置", async () => {
    const controller = createController()
    const events: unknown[] = []
    controller.on("event", (ownerId, event) => events.push([ownerId, event]))

    const { sessionId } = await controller.connect(7, target, documentId, connectionId)
    const socket = mocks.sockets[0]!
    expect(socket.url.toString()).toBe("wss://chat.example.com/api/client/document/collaboration")
    expect(socket.options).toMatchObject({
      handshakeTimeout: DOCUMENT_COLLABORATION_LIMITS.connectionHandshakeTimeoutMs,
      headers: { Cookie: "session=secret", Origin: "https://chat.example.com" },
      maxPayload: DOCUMENT_COLLABORATION_LIMITS.maxFrameBytes,
      perMessageDeflate: false,
      rejectUnauthorized: true,
    })
    expect(socket.options.ca).toEqual([Buffer.from("ca")])
    expect(socket.hasListeners("ping")).toBe(false)

    const frame = documentFrame(documentId)
    controller.send(7, sessionId, frame)
    expect(socket.sent).toHaveLength(0)
    socket.readyState = mocks.FakeWebSocket.OPEN
    socket.emit("open")
    expect(socket.sent).toEqual([Buffer.from(frame)])
    expect(events).toContainEqual([7, { connectionId, sessionId, type: "open" }])
  })

  it("隔离 owner 和文档，并复制合法的双向二进制帧", async () => {
    const controller = createController()
    const events: Array<[number, { data?: Uint8Array; type: string }]> = []
    controller.on("event", (ownerId, event) => events.push([ownerId, event]))
    const { sessionId } = await controller.connect(3, target, documentId, connectionId)
    const socket = mocks.sockets[0]!
    socket.readyState = mocks.FakeWebSocket.OPEN
    socket.emit("open")
    const frame = documentFrame(documentId, 5)

    expect(() => controller.send(4, sessionId, frame)).toThrow("会话无效")
    const incoming = Buffer.from(frame)
    socket.emit("message", incoming, true)
    incoming.fill(0)
    expect(events.at(-1)?.[0]).toBe(3)
    expect([...events.at(-1)![1].data!]).toEqual([...frame])

    expect(() =>
      controller.send(3, sessionId, documentFrame("650e8400-e29b-41d4-a716-446655440000")),
    ).toThrow("帧与会话不匹配")
  })

  it("替换同 owner、Target 和文档的旧连接，并限制每个 owner 八个会话", async () => {
    const controller = createController()
    await controller.connect(1, target, documentId, connectionId)
    const replaced = mocks.sockets[0]!
    await controller.connect(1, target, documentId, connectionId)
    expect(replaced.closeCalls).toEqual([[1000, "replaced"]])

    for (let index = 0; index < DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions; index += 1) {
      await controller.connect(2, target, indexedDocumentId(index), indexedConnectionId(index))
    }
    await expect(
      controller.connect(2, target, indexedDocumentId(9), indexedConnectionId(9)),
    ).rejects.toThrow("会话数量超过限制")

    await expect(
      controller.connect(3, target, indexedDocumentId(9), indexedConnectionId(9)),
    ).resolves.toHaveProperty("sessionId")
  })

  it("并发建连预留 owner 配额，且生命周期清理会取消尚未完成的连接", async () => {
    const cookieRequests = Array.from(
      { length: DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions },
      () => deferred<ReadonlyArray<{ name: string; value: string }>>(),
    )
    let cookieRequestIndex = 0
    const controller = createController({
      getCookies: vi
        .fn()
        .mockImplementation(
          () => cookieRequests[cookieRequestIndex++]?.promise ?? Promise.resolve([]),
        ),
    })
    const connections = Array.from(
      { length: DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions },
      (_, index) =>
        controller.connect(8, target, indexedDocumentId(index), indexedConnectionId(index)),
    )

    await expect(
      controller.connect(8, target, indexedDocumentId(9), indexedConnectionId(9)),
    ).rejects.toThrow("会话数量超过限制")
    controller.closeOwner(8)
    for (const request of cookieRequests) request.resolve([])
    await expect(Promise.all(connections)).rejects.toThrow("文档协作连接已取消")
    expect(mocks.sockets).toHaveLength(0)
  })

  it("同一文档的并发替换仍受底层准备任务上限约束", async () => {
    const cookieRequests = Array.from(
      { length: DOCUMENT_COLLABORATION_LIMITS.maxOwnerPreparations },
      () => deferred<ReadonlyArray<{ name: string; value: string }>>(),
    )
    let cookieRequestIndex = 0
    const controller = createController({
      getCookies: vi.fn().mockImplementation(() => cookieRequests[cookieRequestIndex++]!.promise),
    })
    const connections = Array.from(
      { length: DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions },
      (_, index) => controller.connect(10, target, documentId, indexedConnectionId(index)),
    )

    await expect(
      controller.connect(10, target, documentId, indexedConnectionId(9)),
    ).rejects.toThrow("连接准备任务数量超过限制")
    expect(cookieRequestIndex).toBe(DOCUMENT_COLLABORATION_LIMITS.maxOwnerPreparations)

    for (const request of cookieRequests) request.resolve([])
    await expect(Promise.all(connections)).rejects.toThrow("文档协作连接已取消")
    expect(mocks.sockets).toHaveLength(1)
  })

  it("按 owner 和 connectionId 取消 pending，并立即释放配额", async () => {
    const cookieRequests = Array.from(
      { length: DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions + 1 },
      () => deferred<ReadonlyArray<{ name: string; value: string }>>(),
    )
    let cookieRequestIndex = 0
    const controller = createController({
      getCookies: vi.fn().mockImplementation(() => cookieRequests[cookieRequestIndex++]!.promise),
    })
    const connections = Array.from(
      { length: DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions },
      (_, index) =>
        controller.connect(11, target, indexedDocumentId(index), indexedConnectionId(index)),
    )

    controller.cancel(12, indexedConnectionId(0))
    await expect(
      controller.connect(11, target, indexedDocumentId(9), indexedConnectionId(9)),
    ).rejects.toThrow("会话数量超过限制")

    controller.cancel(11, indexedConnectionId(0))
    await expect(
      controller.connect(11, target, indexedDocumentId(9), indexedConnectionId(9)),
    ).rejects.toThrow("连接准备任务数量超过限制")
    cookieRequests[0]?.resolve([])

    await expect(connections[0]).rejects.toThrow("文档协作连接已取消")
    const replacement = controller.connect(11, target, indexedDocumentId(9), indexedConnectionId(9))
    for (const request of cookieRequests.slice(1)) request.resolve([])
    await expect(Promise.all(connections.slice(1))).resolves.toHaveLength(
      DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions - 1,
    )
    await expect(replacement).resolves.toHaveProperty("sessionId")
  })

  it("连接准备超时后释放 pending 配额且不会创建 socket", async () => {
    vi.useFakeTimers()
    const cookies = deferred<ReadonlyArray<{ name: string; value: string }>>()
    const getCookies = vi
      .fn()
      .mockReturnValueOnce(cookies.promise)
      .mockResolvedValue([{ name: "session", value: "secret" }])
    const controller = createController({ getCookies })
    const connection = controller.connect(13, target, documentId, connectionId)

    const rejection = expect(connection).rejects.toThrow("连接准备超时")
    await vi.advanceTimersByTimeAsync(DOCUMENT_COLLABORATION_LIMITS.connectionPreparationTimeoutMs)
    await rejection
    expect(mocks.sockets).toHaveLength(0)

    await expect(
      controller.connect(13, target, indexedDocumentId(9), indexedConnectionId(9)),
    ).resolves.toHaveProperty("sessionId")
  })

  it("已取消但尚未结束的底层准备任务仍受独立上限约束", async () => {
    const cookieRequests = Array.from(
      { length: DOCUMENT_COLLABORATION_LIMITS.maxOwnerPreparations },
      () => deferred<ReadonlyArray<{ name: string; value: string }>>(),
    )
    let cookieRequestIndex = 0
    const controller = createController({
      getCookies: vi.fn().mockImplementation(() => cookieRequests[cookieRequestIndex++]!.promise),
    })
    const connections = cookieRequests.map((_, index) => {
      const pending = controller.connect(14, target, documentId, indexedConnectionId(index))
      void pending.catch(() => undefined)
      return pending
    })

    await expect(
      controller.connect(14, target, documentId, indexedConnectionId(9)),
    ).rejects.toThrow("连接准备任务数量超过限制")
    expect(cookieRequestIndex).toBe(DOCUMENT_COLLABORATION_LIMITS.maxOwnerPreparations)

    for (const request of cookieRequests) request.resolve([])
    await expect(Promise.all(connections)).rejects.toThrow("文档协作连接已取消")
  })

  it("WebSocket 握手超时会关闭 session 并释放 owner 配额", async () => {
    vi.useFakeTimers()
    const controller = createController()
    const sessions = await Promise.all(
      Array.from({ length: DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions }, (_, index) =>
        controller.connect(15, target, indexedDocumentId(index), indexedConnectionId(index)),
      ),
    )

    await expect(
      controller.connect(15, target, indexedDocumentId(9), indexedConnectionId(9)),
    ).rejects.toThrow("会话数量超过限制")
    await vi.advanceTimersByTimeAsync(DOCUMENT_COLLABORATION_LIMITS.connectionHandshakeTimeoutMs)
    expect(mocks.sockets.every((socket) => socket.closeCalls.at(-1)?.[0] === 1013)).toBe(true)
    expect(sessions).toHaveLength(DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions)

    await expect(
      controller.connect(15, target, indexedDocumentId(9), indexedConnectionId(9)),
    ).resolves.toHaveProperty("sessionId")
  })

  it("应用关闭会取消正在准备的连接且不允许异步恢复后创建 socket", async () => {
    const cookies = deferred<ReadonlyArray<{ name: string; value: string }>>()
    const controller = createController({ getCookies: vi.fn().mockReturnValue(cookies.promise) })
    const connection = controller.connect(9, target, documentId, connectionId)

    controller.shutdown()
    cookies.resolve([{ name: "session", value: "secret" }])

    await expect(connection).rejects.toThrow("文档协作连接已取消")
    expect(mocks.sockets).toHaveLength(0)
  })

  it("帧和背压队列超限时发送稳定错误并关闭会话", async () => {
    const controller = createController()
    const events: Array<{ code?: string; type: string }> = []
    controller.on("event", (_ownerId, event) => events.push(event))
    const first = await controller.connect(1, target, documentId, connectionId)

    expect(() =>
      controller.send(
        1,
        first.sessionId,
        new Uint8Array(DOCUMENT_COLLABORATION_LIMITS.maxFrameBytes + 1),
      ),
    ).toThrow("帧超过限制")
    expect(events).toContainEqual({
      code: "frame_too_large",
      connectionId,
      sessionId: first.sessionId,
      type: "error",
    })

    const second = await controller.connect(1, target, documentId, connectionId)
    const socket = mocks.sockets.at(-1)!
    socket.readyState = mocks.FakeWebSocket.OPEN
    socket.emit("open")
    socket.bufferedAmount = 1
    const maximumFrame = documentFrame(documentId, DOCUMENT_COLLABORATION_LIMITS.maxFrameBytes)
    controller.send(1, second.sessionId, maximumFrame)
    controller.send(1, second.sessionId, maximumFrame)
    expect(() => controller.send(1, second.sessionId, documentFrame(documentId))).toThrow(
      "发送队列超过限制",
    )
    expect(events).toContainEqual({
      code: "backpressure_limit",
      connectionId,
      sessionId: second.sessionId,
      type: "error",
    })
  })

  it("过滤陈旧事件，映射 TLS/权限错误并幂等清理生命周期", async () => {
    const controller = createController()
    const events: Array<{ code?: number | string; reason?: string; type: string }> = []
    controller.on("event", (_ownerId, event) => events.push(event))
    const first = await controller.connect(5, target, documentId, connectionId)
    const socket = mocks.sockets[0]!
    socket.emit("error", new Error("TLS certificate failed"))
    expect(events.at(-1)).toMatchObject({ code: "tls_failed", connectionId, type: "error" })
    socket.emit("close", 4403, Buffer.from("private server detail"))
    expect(events.at(-1)).toEqual({
      code: 4403,
      connectionId,
      reason: "permission_denied",
      sessionId: first.sessionId,
      type: "close",
    })
    socket.emit("message", Buffer.from(documentFrame(documentId)), true)
    expect(events.at(-1)?.type).toBe("close")

    const second = await controller.connect(6, target, indexedDocumentId(2), indexedConnectionId(2))
    const connectingSocket = mocks.sockets.at(-1)!
    controller.closeOwner(6)
    expect(() =>
      connectingSocket.emit("error", new Error("WebSocket was closed before connection")),
    ).not.toThrow()
    connectingSocket.emit("close", 1000, Buffer.from("owner closed"))
    controller.closeOwner(6)
    expect(() => controller.send(6, second.sessionId, documentFrame(indexedDocumentId(2)))).toThrow(
      "会话无效",
    )
    controller.shutdown()
    await expect(controller.connect(6, target, documentId, connectionId)).rejects.toThrow(
      "正在关闭",
    )
  })

  it("拒绝失效 Target，且不接受 Renderer 提交的网络参数或其他类型帧", async () => {
    const invalidTarget = { ...target, userId: "another-user" }
    await expect(
      createController().connect(1, invalidTarget, documentId, connectionId),
    ).rejects.toThrow("认证目标已失效")
    expect(mocks.sockets).toHaveLength(0)

    const controller = createController()
    const { sessionId } = await controller.connect(1, target, documentId, connectionId)
    await expect(
      controller.connect(
        1,
        target,
        {
          cookie: "secret",
          headers: {},
          origin: "https://evil.example",
          url: "wss://evil.example",
        },
        connectionId,
      ),
    ).rejects.toThrow("文档标识无效")
    expect(() => controller.send(1, sessionId, "正文内容")).toThrow("帧无效")
    expect(() => controller.send(1, sessionId, { data: [] })).toThrow("帧无效")
    expect(mocks.sockets).toHaveLength(1)
  })
})

describe("文档协作 Main 安全辅助规则", () => {
  it("只构造固定 WSS 路径并仅允许开发 localhost WS", () => {
    expect(buildDocumentCollaborationUrl("https://chat.example.com/base").toString()).toBe(
      "wss://chat.example.com/api/client/document/collaboration",
    )
    expect(buildDocumentCollaborationUrl("http://localhost:8080").toString()).toBe(
      "ws://localhost:8080/api/client/document/collaboration",
    )
    expect(() => buildDocumentCollaborationUrl("http://chat.example.com")).toThrow()
  })

  it("要求 Hocuspocus 帧路由名与绑定文档一致", () => {
    expect(frameMatchesDocument(documentFrame(documentId), documentId)).toBe(true)
    expect(frameMatchesDocument(documentFrame(documentId), indexedDocumentId(2))).toBe(false)
    expect(frameMatchesDocument(Uint8Array.of(9), documentId)).toBe(true)
    expect(frameMatchesDocument(Uint8Array.of(10), documentId)).toBe(true)
    expect(frameMatchesDocument(Uint8Array.of(3, 1), documentId)).toBe(false)
  })
})

function createController(options?: {
  getCookies?: () => Promise<ReadonlyArray<{ name: string; value: string }>>
}) {
  const profiles = {
    require: vi.fn().mockReturnValue({
      id: target.id,
      lastUserId: target.userId,
      normalizedUrl: target.normalizedUrl,
    }),
  } as unknown as ServerProfiles
  const sessions = {
    for: vi.fn().mockReturnValue({
      cookies: {
        get:
          options?.getCookies ?? vi.fn().mockResolvedValue([{ name: "session", value: "secret" }]),
      },
    }),
  } as unknown as SessionController
  return new DocumentCollaborationController(profiles, sessions)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function documentFrame(id: string, size = 38): Uint8Array {
  const encoded = new TextEncoder().encode(id)
  const frame = new Uint8Array(Math.max(size, encoded.byteLength + 2))
  frame[0] = encoded.byteLength
  frame.set(encoded, 1)
  return frame
}

function indexedDocumentId(index: number): string {
  return `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`
}

function indexedConnectionId(index: number): string {
  return `650e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`
}
