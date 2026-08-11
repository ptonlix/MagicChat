import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const socketMocks = vi.hoisted(() => {
  class FakeWebSocket {
    static instances: FakeWebSocket[] = []
    static readonly CLOSED = 3
    static readonly OPEN = 1
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    readyState = 0

    constructor(
      readonly url: URL,
      readonly options: { headers?: Record<string, string> },
    ) {
      FakeWebSocket.instances.push(this)
    }

    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      const listeners = this.listeners.get(event) ?? []
      listeners.push(listener)
      this.listeners.set(event, listeners)
      return this
    }

    close(code = 1000, reason = "") {
      this.readyState = FakeWebSocket.CLOSED
      this.emit("close", code, Buffer.from(reason))
    }

    open() {
      this.readyState = FakeWebSocket.OPEN
      this.emit("open")
    }

    terminate() {
      this.readyState = FakeWebSocket.CLOSED
      this.emit("close", 1006, Buffer.from("network interrupted"))
    }

    send() {}
  }
  return { FakeWebSocket }
})

vi.mock("ws", () => ({ default: socketMocks.FakeWebSocket }))

import { RealtimeController } from "@main/realtime-controller"
import type { Diagnostics } from "@main/diagnostics"
import type { AuthenticatedTarget } from "@shared/client-contract"

const target: AuthenticatedTarget = {
  id: "server-1",
  normalizedUrl: "https://chat.example.test",
  userId: "user-1",
}

describe("RealtimeController 诊断", () => {
  const recordEvent = vi.fn().mockResolvedValue(undefined)
  const createEpisode = vi.fn((reason: string) => `${reason}-episode`)
  const getCurrentEpisodeId = vi.fn().mockReturnValue(undefined)
  const cookies = { get: vi.fn().mockResolvedValue([]) }
  const session = {
    cookies,
    fetch: vi.fn().mockResolvedValue({ status: 200 }),
    resolveProxy: vi.fn().mockResolvedValue("DIRECT"),
  }
  const profiles = { require: vi.fn().mockReturnValue({ ...target }) }
  const sessions = { for: vi.fn().mockReturnValue(session) }

  const createController = () =>
    new RealtimeController(profiles as never, sessions as never, undefined, {
      createEpisode,
      getCurrentEpisodeId,
      recordEvent,
    } as unknown as Diagnostics)

  beforeEach(() => {
    vi.useFakeTimers()
    socketMocks.FakeWebSocket.instances = []
    recordEvent.mockClear()
    createEpisode.mockClear()
    getCurrentEpisodeId.mockClear().mockReturnValue(undefined)
    cookies.get.mockClear().mockResolvedValue([])
    session.fetch.mockClear().mockResolvedValue({ status: 200 })
    session.resolveProxy.mockClear().mockResolvedValue("DIRECT")
    profiles.require.mockClear().mockReturnValue({ ...target })
    sessions.for.mockClear().mockReturnValue(session)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("记录连接、异常关闭、鉴权检查、重连和重复 system.ready，且不写原始关闭原因", async () => {
    const controller = createController()
    const snapshots: Array<{ connectionInstanceId?: string; episodeId?: string; ready: boolean }> =
      []
    controller.on("snapshot", (snapshot) => snapshots.push(snapshot))

    await controller.connect(target)
    const first = socketMocks.FakeWebSocket.instances[0]
    first.open()
    first.emit("message", Buffer.from(JSON.stringify(systemReadyEvent())), false)
    first.emit("message", Buffer.from(JSON.stringify(systemReadyEvent())), false)
    first.emit("close", 1006, Buffer.from("network interrupted with secret-looking text"))
    await vi.runAllTimersAsync()

    expect(socketMocks.FakeWebSocket.instances).toHaveLength(2)
    const types = recordEvent.mock.calls.map(([event]) => event.type)
    expect(types).toEqual(
      expect.arrayContaining([
        "realtime.connection-created",
        "realtime.socket-opened",
        "realtime.socket-closed",
        "realtime.authorization-checked",
        "realtime.reconnect-scheduled",
        "realtime.system-ready",
      ]),
    )
    const readyEvents = recordEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "realtime.system-ready")
    expect(readyEvents.map((event) => event.data.systemReadyCount)).toEqual([1, 2])
    const close = recordEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "realtime.socket-closed")
    expect(close).toMatchObject({
      context: expect.objectContaining({
        connectionInstanceId: expect.any(String),
        episodeId: "reconnect-episode",
      }),
      data: expect.objectContaining({
        closeCode: 1006,
        closeReasonLength: expect.any(Number),
        reason: "network",
      }),
    })
    expect(JSON.stringify(close)).not.toContain("secret-looking")
    expect(snapshots.some((snapshot) => snapshot.ready)).toBe(true)
  })

  it("鉴权失败停止重连并保留受控的失败计数", async () => {
    const controller = createController()
    session.fetch.mockResolvedValueOnce({ status: 401 })

    await controller.connect(target)
    const socket = socketMocks.FakeWebSocket.instances[0]
    socket.open()
    socket.emit("close", 1006, Buffer.from("authorization failed"))
    await vi.runAllTimersAsync()

    expect(socketMocks.FakeWebSocket.instances).toHaveLength(1)
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ responseStatus: 401 }),
        type: "realtime.authorization-checked",
      }),
    )
  })

  it("普通实时事件只广播业务事件，不记录状态变化或发送 snapshot", async () => {
    const controller = createController()
    const envelopes: unknown[] = []
    const snapshots: unknown[] = []
    controller.on("envelope", (envelope) => envelopes.push(envelope))
    controller.on("snapshot", (snapshot) => snapshots.push(snapshot))

    await controller.connect(target)
    snapshots.length = 0
    recordEvent.mockClear()

    const socket = socketMocks.FakeWebSocket.instances[0]
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "conversation.updated",
          kind: "event",
          payload: { changed: true },
          v: 1,
        }),
      ),
      false,
    )

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]).toMatchObject({ event: "conversation.updated", kind: "event" })
    expect(snapshots).toHaveLength(0)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it("首次连接和断线恢复分别使用由 Diagnostics 创建的片段", async () => {
    const controller = createController()

    await controller.connect(target)
    const socket = socketMocks.FakeWebSocket.instances[0]
    socket.open()
    socket.emit("close", 1006, Buffer.from("network interrupted"))
    await vi.runAllTimersAsync()

    expect(createEpisode).toHaveBeenNthCalledWith(1, "connection")
    expect(createEpisode).toHaveBeenNthCalledWith(2, "reconnect")
    const created = recordEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "realtime.connection-created")
    const reconnectEvents = recordEvent.mock.calls
      .map(([event]) => event)
      .filter((event) =>
        ["realtime.socket-closed", "realtime.reconnect-scheduled"].includes(event.type),
      )
    expect(created?.context.episodeId).toBe("connection-episode")
    expect(reconnectEvents).toHaveLength(2)
    expect(reconnectEvents.every((event) => event.context.episodeId === "reconnect-episode")).toBe(
      true,
    )
  })
})

function systemReadyEvent() {
  return { event: "system.ready", kind: "event", v: 1 }
}
