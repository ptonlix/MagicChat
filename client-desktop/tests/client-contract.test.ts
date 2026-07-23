import { describe, expect, it } from "vitest"
import { assertClientPath, normalizeServerUrl, targetKey } from "@shared/client-contract"

describe("桌面客户端契约", () => {
  it("规范化服务器地址且拒绝敏感组成部分", () => {
    expect(normalizeServerUrl(" https://CHAT.EXAMPLE.com/ ")).toBe("https://chat.example.com")
    expect(() => normalizeServerUrl("http://chat.example.com")).toThrow("HTTPS")
    expect(() => normalizeServerUrl("https://user:pass@chat.example.com")).toThrow("凭据")
  })

  it("只允许客户端 API 相对路径", () => {
    expect(assertClientPath("/api/client/me?view=full")).toBe("/api/client/me?view=full")
    expect(() => assertClientPath("https://evil.test/api/client/me")).toThrow()
    expect(() => assertClientPath("/api/admin/users")).toThrow()
  })

  it("认证目标键不会因分隔符产生碰撞", () => {
    expect(targetKey({ id: "a:b", normalizedUrl: "https://one.test", userId: "c" }))
      .not.toBe(targetKey({ id: "a", normalizedUrl: "https://one.test", userId: "b:c" }))
  })
})
