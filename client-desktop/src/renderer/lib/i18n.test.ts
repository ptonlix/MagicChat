import { describe, expect, it } from "vitest"

import { messages, translate, type TranslationKey } from "@/lib/i18n"

describe("i18n 翻译", () => {
  it("中英文词典包含完全相同的键集", () => {
    expect(Object.keys(messages["zh-CN"]).sort()).toEqual(Object.keys(messages.en).sort())
  })

  it("按语言返回文案并支持参数插值", () => {
    expect(translate("zh-CN", "settings.nav.general")).toBe("通用")
    expect(translate("en", "settings.nav.general")).toBe("General")
    expect(translate("zh-CN", "settings.update.target", { version: "1.2.0" })).toBe(
      "目标版本：1.2.0",
    )
    expect(translate("en", "settings.update.target", { version: "1.2.0" })).toBe(
      "Target version: 1.2.0",
    )
    expect(translate("zh-CN", "documentWindow.error.windowLimit")).toContain("8 个文档窗口")
    expect(translate("en", "documentWindow.error.windowLimit")).toContain("8 document windows")
    expect(translate("zh-CN", "windowControls.close")).toBe("关闭窗口")
    expect(translate("en", "windowControls.close")).toBe("Close window")
  })

  it("未知键回退为键本身", () => {
    expect(translate("en", "settings.does-not-exist" as TranslationKey)).toBe(
      "settings.does-not-exist",
    )
  })
})
