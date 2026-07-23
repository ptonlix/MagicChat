import { describe, expect, it } from "vitest"

import { parseRendererRuntimeSnapshot } from "@main/runtime-snapshot-validation"

const validSnapshot = {
  activeRefreshes: 1,
  activeRequests: 2,
  data: { contacts: 3, conversations: 4, loadedConversations: 5, messages: 6, projects: 7 },
  eventLoopLagMs: 8,
  longTasks: { count: 9, maxDurationMs: 10 },
  page: "chat",
}

describe("parseRendererRuntimeSnapshot", () => {
  it.each([null, [], "invalid", { ...validSnapshot, data: [] }, { ...validSnapshot, longTasks: null }])(
    "拒绝非法对象或嵌套字段 %#",
    (value) => expect(() => parseRendererRuntimeSnapshot(value)).toThrow()
  )

  it("限制数值范围并降级非法枚举值", () => {
    const result = parseRendererRuntimeSnapshot({
      ...validSnapshot,
      activeRefreshes: -1,
      activeRequests: Number.POSITIVE_INFINITY,
      data: { contacts: -1, conversations: 2_000_000, loadedConversations: 1, messages: 20_000_000, projects: 1 },
      eventLoopLagMs: 900_000,
      lastRequest: { ageMs: -1, durationMs: 900_000, group: "api/client/private-id", method: "get", status: 5_000 },
      longTasks: { count: 200_000, maxDurationMs: 900_000 },
      page: "private-page",
    })

    expect(result).toMatchObject({
      activeRefreshes: 0,
      activeRequests: 0,
      data: { contacts: 0, conversations: 1_000_000, messages: 10_000_000 },
      eventLoopLagMs: 600_000,
      lastRequest: { ageMs: 0, durationMs: 600_000, group: "unknown", method: "UNKNOWN", status: 999 },
      longTasks: { count: 100_000, maxDurationMs: 600_000 },
      page: "unknown",
    })
  })

  it("拒绝非法刷新任务名称", () => {
    expect(() => parseRendererRuntimeSnapshot({
      ...validSnapshot,
      lastRefresh: { ageMs: 1, durationMs: 2, name: "private-task" },
    })).toThrow("刷新诊断快照无效")
  })
})
