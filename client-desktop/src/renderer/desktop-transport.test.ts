import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopBridge } from "@shared/bridge"
import { DesktopWebSocket, installDesktopFetch } from "./desktop-transport"
import { startRuntimeDiagnostics } from "@/lib/runtime-diagnostics"
import { RealtimeClient } from "@/lib/realtime-client"

describe("installDesktopFetch", () => {
  const reportRuntime = vi.fn()
  const streamStart = vi.fn()
  const streamChunk = vi.fn()
  const streamFinish = vi.fn()
  const streamAbort = vi.fn()
  const cancel = vi.fn()
  const request = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    reportRuntime.mockReset()
    streamStart.mockReset().mockResolvedValue("stream-1")
    streamChunk.mockReset().mockResolvedValue(undefined)
    streamFinish.mockReset().mockResolvedValue({
      body: { ok: true },
      headers: { "content-type": "application/json" },
      status: 201,
    })
    streamAbort.mockReset().mockResolvedValue(undefined)
    cancel.mockReset().mockResolvedValue(undefined)
    request.mockReset().mockResolvedValue({ body: { ok: true }, headers: {}, status: 200 })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        diagnostics: { reportRuntime },
        transport: {
          cancel,
          request,
          streamAbort,
          streamChunk,
          streamFinish,
          streamStart,
        },
      } as unknown as DesktopBridge,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("将 Multipart 上传计入请求并在完成后归零", async () => {
    const restoreFetch = installDesktopFetch({
      id: "server",
      normalizedUrl: "https://chat.example.com",
      userId: "user",
    })
    const stopDiagnostics = startRuntimeDiagnostics(1_000)
    const body = new FormData()
    body.append("file", new Blob(["content"]), "test.txt")

    const response = await window.fetch("http://localhost/api/client/temporary-files", {
      body,
      method: "POST",
    })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(response.status).toBe(201)
    expect(streamStart).toHaveBeenCalledOnce()
    expect(reportRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRequests: 0,
        lastRequest: expect.objectContaining({
          group: "api/client/temporary-files",
          method: "POST",
          status: 201,
        }),
      }),
    )

    stopDiagnostics()
    restoreFetch()
  })

  it("Multipart 上传失败时也会结束请求统计", async () => {
    streamStart.mockRejectedValueOnce(new Error("upload failed"))
    const restoreFetch = installDesktopFetch({
      id: "server",
      normalizedUrl: "https://chat.example.com",
      userId: "user",
    })
    const stopDiagnostics = startRuntimeDiagnostics(1_000)
    const body = new FormData()
    body.append("file", new Blob(["content"]), "test.txt")

    await expect(
      window.fetch("http://localhost/api/client/temporary-files", { body, method: "POST" }),
    ).rejects.toThrow("upload failed")
    await vi.advanceTimersByTimeAsync(1_000)

    expect(reportRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRequests: 0,
        lastRequest: expect.objectContaining({
          group: "api/client/temporary-files",
          method: "POST",
        }),
      }),
    )

    stopDiagnostics()
    restoreFetch()
  })

  it("Multipart 上传中止时也会结束请求统计", async () => {
    const controller = new AbortController()
    streamChunk.mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException("aborted", "AbortError")
    })
    const restoreFetch = installDesktopFetch({
      id: "server",
      normalizedUrl: "https://chat.example.com",
      userId: "user",
    })
    const stopDiagnostics = startRuntimeDiagnostics(1_000)
    const body = new FormData()
    body.append("file", new Blob(["content"]), "test.txt")

    await expect(
      window.fetch("http://localhost/api/client/temporary-files", {
        body,
        method: "POST",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(streamAbort).toHaveBeenCalled()
    expect(reportRuntime).toHaveBeenCalledWith(expect.objectContaining({ activeRequests: 0 }))

    stopDiagnostics()
    restoreFetch()
  })

  it("预取消的普通和 Multipart 请求不发送 IPC", async () => {
    const controller = new AbortController()
    controller.abort()
    const restoreFetch = installDesktopFetch({
      id: "server",
      normalizedUrl: "https://chat.example.com",
      userId: "user",
    })

    await expect(
      window.fetch("http://localhost/api/client/me", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
    const body = new FormData()
    body.append("file", new Blob(["content"]), "test.txt")
    await expect(
      window.fetch("http://localhost/api/client/temporary-files", {
        body,
        method: "POST",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(request).not.toHaveBeenCalled()
    expect(streamStart).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    restoreFetch()
  })

  it("把在途 AbortSignal 映射为相同 requestId 的取消并保留原因", async () => {
    let resolveRequest:
      | ((value: { body: unknown; headers: Record<string, string>; status: number }) => void)
      | undefined
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
    )
    const controller = new AbortController()
    const reason = new DOMException("停止搜索", "AbortError")
    const restoreFetch = installDesktopFetch({
      id: "server",
      normalizedUrl: "https://chat.example.com",
      userId: "user",
    })
    const response = window.fetch("http://localhost/api/client/search/messages", {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    const requestId = request.mock.calls[0]?.[1].requestId
    controller.abort(reason)

    await expect(response).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledWith(requestId)
    resolveRequest?.({ body: { stale: true }, headers: {}, status: 200 })
    restoreFetch()
  })

  it("卸载 adapter 会取消全部活动请求并阻止旧结果提交", async () => {
    request.mockImplementation(() => new Promise(() => undefined))
    const restoreFetch = installDesktopFetch({
      id: "server",
      normalizedUrl: "https://chat.example.com",
      userId: "user",
    })
    const first = window.fetch("http://localhost/api/client/me")
    const second = window.fetch("http://localhost/api/client/conversations")
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    restoreFetch()

    await expect(first).rejects.toMatchObject({ name: "AbortError" })
    await expect(second).rejects.toMatchObject({ name: "AbortError" })
    expect(new Set(cancel.mock.calls.map(([requestId]) => requestId))).toEqual(
      new Set(request.mock.calls.map(([, value]) => value.requestId)),
    )
  })
})

describe("DesktopWebSocket realtime snapshot", () => {
  it("订阅快照缺失时使用 connect 返回值建立关联并记录遗漏", async () => {
    let envelopeListener: ((value: unknown) => void) | undefined
    const record = vi.fn().mockResolvedValue({ eventSeq: 1, timestamp: "2025-01-01T00:00:00.000Z" })
    const target = { id: "server", normalizedUrl: "https://chat.example.com", userId: "user" }
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        diagnostics: { record },
        realtime: {
          close: vi.fn().mockResolvedValue(undefined),
          connect: vi.fn().mockResolvedValue({
            connectionInstanceId: "connection-1",
            episodeId: "episode-1",
            ready: true,
            status: "connected",
            targetKey: "server:https%3A%2F%2Fchat.example.com:user",
            targetScope: "server",
          }),
          send: vi.fn(),
          subscribe: vi.fn((listener) => {
            envelopeListener = listener
            return () => undefined
          }),
          subscribeSnapshot: vi.fn(() => () => undefined),
          subscribeUnauthorized: vi.fn(() => () => undefined),
        },
      } as unknown as DesktopBridge,
    })
    const client = new RealtimeClient({ createWebSocket: () => new DesktopWebSocket(target) })

    client.connect()
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe("connected"))

    expect(client.getSnapshot().ready).toBe(false)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          connectionInstanceId: "connection-1",
          episodeId: "episode-1",
          targetScope: "server",
        },
        type: "realtime-bridge.snapshot-missed",
      }),
    )
    expect(record).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "realtime-bridge.snapshot-received" }),
    )

    envelopeListener?.({ event: "system.ready", kind: "event", v: 1 })
    expect(client.getSnapshot().ready).toBe(true)
  })

  it("订阅推送到达时记录已接收快照而不误报遗漏", async () => {
    let snapshotListener: ((value: unknown) => void) | undefined
    const record = vi.fn().mockResolvedValue({ eventSeq: 1, timestamp: "2025-01-01T00:00:00.000Z" })
    const target = { id: "server", normalizedUrl: "https://chat.example.com", userId: "user" }
    const snapshot = {
      connectionInstanceId: "connection-1",
      episodeId: "episode-1",
      ready: false,
      status: "connecting" as const,
      targetKey: "server:https%3A%2F%2Fchat.example.com:user",
      targetScope: "server",
    }
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        diagnostics: { record },
        realtime: {
          close: vi.fn().mockResolvedValue(undefined),
          connect: vi.fn().mockResolvedValue(snapshot),
          send: vi.fn(),
          subscribe: vi.fn(() => () => undefined),
          subscribeSnapshot: vi.fn((listener) => {
            snapshotListener = listener
            return () => undefined
          }),
          subscribeUnauthorized: vi.fn(() => () => undefined),
        },
      } as unknown as DesktopBridge,
    })
    const client = new RealtimeClient({ createWebSocket: () => new DesktopWebSocket(target) })

    client.connect()
    snapshotListener?.(snapshot)
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe("connected"))

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ type: "realtime-bridge.snapshot-received" }),
    )
    expect(record).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "realtime-bridge.snapshot-missed" }),
    )
  })
})
