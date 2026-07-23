import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopBridge } from "@shared/bridge"
import { installDesktopFetch } from "./desktop-transport"
import { startRuntimeDiagnostics } from "@/lib/runtime-diagnostics"

describe("installDesktopFetch", () => {
  const reportRuntime = vi.fn()
  const streamStart = vi.fn()
  const streamChunk = vi.fn()
  const streamFinish = vi.fn()
  const streamAbort = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    reportRuntime.mockReset()
    streamStart.mockReset().mockResolvedValue("stream-1")
    streamChunk.mockReset().mockResolvedValue(undefined)
    streamFinish.mockReset().mockResolvedValue({ body: { ok: true }, headers: { "content-type": "application/json" }, status: 201 })
    streamAbort.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        diagnostics: { reportRuntime },
        transport: {
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
    const restoreFetch = installDesktopFetch({ id: "server", normalizedUrl: "https://chat.example.com", userId: "user" })
    const stopDiagnostics = startRuntimeDiagnostics(1_000)
    const body = new FormData()
    body.append("file", new Blob(["content"]), "test.txt")

    const response = await window.fetch("http://localhost/api/client/temporary-files", { body, method: "POST" })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(response.status).toBe(201)
    expect(streamStart).toHaveBeenCalledOnce()
    expect(reportRuntime).toHaveBeenCalledWith(expect.objectContaining({
      activeRequests: 0,
      lastRequest: expect.objectContaining({ group: "api/client/temporary-files", method: "POST", status: 201 }),
    }))

    stopDiagnostics()
    restoreFetch()
  })

  it("Multipart 上传失败时也会结束请求统计", async () => {
    streamStart.mockRejectedValueOnce(new Error("upload failed"))
    const restoreFetch = installDesktopFetch({ id: "server", normalizedUrl: "https://chat.example.com", userId: "user" })
    const stopDiagnostics = startRuntimeDiagnostics(1_000)
    const body = new FormData()
    body.append("file", new Blob(["content"]), "test.txt")

    await expect(window.fetch("http://localhost/api/client/temporary-files", { body, method: "POST" })).rejects.toThrow("upload failed")
    await vi.advanceTimersByTimeAsync(1_000)

    expect(reportRuntime).toHaveBeenCalledWith(expect.objectContaining({
      activeRequests: 0,
      lastRequest: expect.objectContaining({ group: "api/client/temporary-files", method: "POST" }),
    }))

    stopDiagnostics()
    restoreFetch()
  })

  it("Multipart 上传中止时也会结束请求统计", async () => {
    const controller = new AbortController()
    streamChunk.mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException("aborted", "AbortError")
    })
    const restoreFetch = installDesktopFetch({ id: "server", normalizedUrl: "https://chat.example.com", userId: "user" })
    const stopDiagnostics = startRuntimeDiagnostics(1_000)
    const body = new FormData()
    body.append("file", new Blob(["content"]), "test.txt")

    await expect(window.fetch("http://localhost/api/client/temporary-files", {
      body,
      method: "POST",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(streamAbort).toHaveBeenCalled()
    expect(reportRuntime).toHaveBeenCalledWith(expect.objectContaining({ activeRequests: 0 }))

    stopDiagnostics()
    restoreFetch()
  })
})
