import { describe, expect, it } from "vitest"

import { formatUnreadBadge } from "@main/unread-badge"

describe("formatUnreadBadge", () => {
  it.each([
    [0, ""],
    [1, "1"],
    [99, "99"],
    [100, "99+"],
    [9999, "99+"],
  ])("将 %i 条未读格式化为 %s", (unreadCount, expected) => {
    expect(formatUnreadBadge(unreadCount)).toBe(expected)
  })
})
