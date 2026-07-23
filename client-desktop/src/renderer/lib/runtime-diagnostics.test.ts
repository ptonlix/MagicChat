import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  beginDiagnosticRequest,
  startRuntimeDiagnostics,
  trackDiagnosticRefresh,
  updateDiagnosticData,
} from "@/lib/runtime-diagnostics"

describe("runtime diagnostics", () => {
  const reportRuntime = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    reportRuntime.mockReset()
    window.history.replaceState({}, "", "/chat/conversation-id")
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: { diagnostics: { reportRuntime } },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("只上报脱敏请求分组、任务耗时和页面数据规模", async () => {
    updateDiagnosticData({ contacts: 20, conversations: 10, loadedConversations: 2, messages: 80, projects: 3 })
    const finishRequest = beginDiagnosticRequest("get", "/api/client/conversations/private-id/messages?cursor=secret")
    await vi.advanceTimersByTimeAsync(25)
    finishRequest(200)
    await trackDiagnosticRefresh("conversations", async () => undefined)

    const stop = startRuntimeDiagnostics(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    stop()

    expect(reportRuntime).toHaveBeenCalledWith(expect.objectContaining({
      activeRefreshes: 0,
      activeRequests: 0,
      data: { contacts: 20, conversations: 10, loadedConversations: 2, messages: 80, projects: 3 },
      lastRefresh: expect.objectContaining({ name: "conversations" }),
      lastRequest: expect.objectContaining({ group: "api/client/conversations", method: "GET", status: 200 }),
      page: "chat",
    }))
    expect(JSON.stringify(reportRuntime.mock.calls)).not.toContain("private-id")
    expect(JSON.stringify(reportRuntime.mock.calls)).not.toContain("secret")
  })

  it("请求结束函数重复调用时不影响其他并发请求", async () => {
    const finishFirst = beginDiagnosticRequest("GET", "/api/client/conversations")
    const finishSecond = beginDiagnosticRequest("GET", "/api/client/contacts")
    finishFirst(200)
    finishFirst(200)

    const stop = startRuntimeDiagnostics(1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(reportRuntime).toHaveBeenCalledWith(expect.objectContaining({ activeRequests: 1 }))
    finishSecond(200)
    stop()
  })
})
