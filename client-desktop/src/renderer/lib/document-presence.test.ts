import { describe, expect, it } from "vitest"
import {
  documentPresenceColor,
  normalizeDocumentPresenceUsers,
  safePresenceColor,
} from "./document-presence"

describe("文档 presence", () => {
  it("生成稳定颜色并回退非法颜色", () => {
    expect(documentPresenceColor("user-1")).toBe(documentPresenceColor("user-1"))
    expect(safePresenceColor("red")).toBe("#64748b")
  })

  it("过滤未知状态、按 ID 去重、当前用户优先并按中文排序", () => {
    const users = normalizeDocumentPresenceUsers(
      [
        {},
        { user: { color: "#0284c7", id: "user-2", name: "张三" } },
        { user: { color: "bad", id: "user-1", name: "当前" } },
        { user: { color: "#ffffff", id: "user-2", name: "重复" } },
      ],
      "user-1",
    )
    expect(users.map((user) => user.id)).toEqual(["user-1", "user-2"])
    expect(users[0]?.color).toBe("#64748b")
  })
})
