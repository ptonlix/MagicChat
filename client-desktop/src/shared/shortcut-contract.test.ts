import { describe, expect, it } from "vitest"

import {
  DEFAULT_SCREENSHOT_SHORTCUT,
  DEFAULT_SEARCH_SHORTCUT,
  DEFAULT_SEND_MESSAGE_SHORTCUT,
  formatShortcutAccelerator,
  normalizeSendMessageShortcutAccelerator,
  normalizeShortcutAccelerator,
} from "@shared/shortcut-contract"

describe("快捷键契约", () => {
  it("提供截图、搜索与发送消息的默认组合", () => {
    expect(DEFAULT_SCREENSHOT_SHORTCUT).toBe("CommandOrControl+Shift+A")
    expect(DEFAULT_SEARCH_SHORTCUT).toBe("CommandOrControl+Shift+F")
    expect(DEFAULT_SEND_MESSAGE_SHORTCUT).toBe("Enter")
  })

  it("规范化修饰键顺序和字母大小写", () => {
    expect(normalizeShortcutAccelerator("Shift+Control+s")).toBe("Control+Shift+S")
  })

  it("拒绝无主修饰键、重复修饰键和未知按键", () => {
    expect(() => normalizeShortcutAccelerator("Shift+A")).toThrow("至少需要")
    expect(() => normalizeShortcutAccelerator("Control+Control+A")).toThrow("修饰键无效")
    expect(() => normalizeShortcutAccelerator("Control+Mouse1")).toThrow("格式无效")
  })

  it("发送消息快捷键单独支持无修饰键的 Enter", () => {
    expect(normalizeSendMessageShortcutAccelerator("Enter")).toBe("Enter")
    expect(normalizeSendMessageShortcutAccelerator("Control+Enter")).toBe("Control+Enter")
    expect(normalizeSendMessageShortcutAccelerator("CommandOrControl+Enter")).toBe(
      "CommandOrControl+Enter",
    )
    expect(() => normalizeSendMessageShortcutAccelerator("Control+k")).toThrow("不受支持")
    expect(() => normalizeShortcutAccelerator("Enter")).toThrow("格式无效")
  })

  it("按平台展示快捷键", () => {
    expect(formatShortcutAccelerator("CommandOrControl+Shift+A", "darwin")).toBe("⌘⇧A")
    expect(formatShortcutAccelerator("CommandOrControl+Shift+A", "win32")).toBe("Ctrl + Shift + A")
    expect(formatShortcutAccelerator("Enter", "darwin")).toBe("↵")
    expect(formatShortcutAccelerator(null, "linux")).toBe("未设置")
  })
})
