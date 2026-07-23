import { describe, expect, it } from "vitest"

import { resolveWindowCloseAction } from "@main/window-close-policy"

describe("resolveWindowCloseAction", () => {
  it("后台运行策略在应用就绪后隐藏窗口", () => {
    expect(resolveWindowCloseAction({
      appReady: true,
      closeBehavior: "background",
      quitting: false,
    })).toBe("hide")
  })

  it("退出策略触发应用退出", () => {
    expect(resolveWindowCloseAction({
      appReady: true,
      closeBehavior: "quit",
      quitting: false,
    })).toBe("quit")
  })

  it("退出清理阶段放行窗口关闭", () => {
    expect(resolveWindowCloseAction({
      appReady: true,
      closeBehavior: "background",
      quitting: true,
    })).toBe("allow")
  })

  it("应用尚未就绪时不隐藏窗口", () => {
    expect(resolveWindowCloseAction({
      appReady: false,
      closeBehavior: "background",
      quitting: false,
    })).toBe("quit")
  })
})
