import { describe, expect, it } from "vitest"
import { normalizeMessagePageLimit } from "@/lib/client-api/messages"

describe("消息分页契约", () => {
  it("单会话单页最多请求 20 条", () => {
    expect(normalizeMessagePageLimit(undefined)).toBe(20)
    expect(normalizeMessagePageLimit(100)).toBe(20)
    expect(normalizeMessagePageLimit(0)).toBe(1)
  })
})
