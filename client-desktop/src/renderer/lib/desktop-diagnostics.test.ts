import { afterEach, describe, expect, it, vi } from "vitest"

import { ClientTransportError } from "@shared/client-contract"
import { ClientDataRequestError } from "@/lib/client-api/core"
import { MessageCatchUpError } from "@/lib/messages/message-catch-up"
import { classifyDiagnosticError, recordRealtimeParseFailure } from "@/lib/desktop-diagnostics"

afterEach(() => {
  vi.useRealTimers()
})

describe("classifyDiagnosticError", () => {
  it("将 HTTP、网络、缓存和解析错误归入受控类别", () => {
    expect(classifyDiagnosticError(new ClientDataRequestError("请求失败", { status: 500 }))).toBe(
      "http",
    )
    expect(classifyDiagnosticError(new ClientTransportError("timeout", "请求超时"))).toBe("network")
    expect(classifyDiagnosticError(new MessageCatchUpError("cache", "缓存提交失败"))).toBe("cache")
    expect(
      classifyDiagnosticError(
        new MessageCatchUpError("network", "请求失败", {
          cause: new ClientDataRequestError("请求失败", { status: 502 }),
        }),
      ),
    ).toBe("http")
    expect(classifyDiagnosticError(new MessageCatchUpError("protocol_cursor", "游标异常"))).toBe(
      "parse",
    )
  })
})

describe("recordRealtimeParseFailure", () => {
  it("首个失败到期后清除窗口，不会与后续失败聚合", async () => {
    vi.useFakeTimers()
    const record = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: { diagnostics: { record } },
    })

    recordRealtimeParseFailure()
    await vi.advanceTimersByTimeAsync(30_000)
    recordRealtimeParseFailure()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(record.mock.calls.map(([event]) => event.type)).toEqual([
      "realtime.event-parse-failed",
      "realtime.event-parse-failed",
    ])
  })
})
