import { describe, expect, it } from "vitest"
import { parseDeepLink } from "@main/deep-links"
import { assertClientPath, normalizeServerUrl, targetKey } from "@shared/client-contract"
import { linuxAutostartEntry } from "@main/system-integration"

describe("桌面安全边界", () => {
  it("拒绝越界 API 与不安全服务器地址", () => {
    expect(() => assertClientPath("/api/client/../../admin")).toThrow()
    expect(() => normalizeServerUrl("http://example.com")).toThrow()
  })

  it("按完整认证目标隔离事件键", () => {
    const first = targetKey({ id: "server", normalizedUrl: "https://one.test", userId: "alice" })
    const second = targetKey({ id: "server", normalizedUrl: "https://one.test", userId: "bob" })
    expect(first).not.toBe(second)
  })

  it("未知服务器必须进入确认分支且敏感参数被拒绝", () => {
    expect(parseDeepLink("magicchat://v1/server/new/conversation/chat", new Set())).toEqual({
      kind: "unknown-server", rawUrl: "magicchat://v1/server/new/conversation/chat", serverId: "new",
    })
    expect(() => parseDeepLink("magicchat://v1/server/new/conversation/chat?token=secret", new Set())).toThrow("敏感")
  })

  it("Linux 开机启动项使用隐藏启动并转义字段代码", () => {
    const entry = linuxAutostartEntry('/opt/Magic Chat/app%test')
    expect(entry).toContain('Exec="/opt/Magic Chat/app%%test" --hidden')
    expect(entry).toContain("X-GNOME-Autostart-enabled=true")
  })
})
