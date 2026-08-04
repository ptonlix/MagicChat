import { describe, expect, it } from "vitest"

import { formatShortcutAccelerator, normalizeShortcutAccelerator } from "@shared/shortcut-contract"

describe("截图快捷键契约", () => {
  it("规范化修饰键顺序和字母大小写", () => {
    expect(normalizeShortcutAccelerator("Shift+Control+s")).toBe("Control+Shift+S")
  })

  it("拒绝无主修饰键、重复修饰键和未知按键", () => {
    expect(() => normalizeShortcutAccelerator("Shift+A")).toThrow("至少需要")
    expect(() => normalizeShortcutAccelerator("Control+Control+A")).toThrow("修饰键无效")
    expect(() => normalizeShortcutAccelerator("Control+Mouse1")).toThrow("格式无效")
  })

  it("按平台展示快捷键", () => {
    expect(formatShortcutAccelerator("CommandOrControl+Shift+A", "darwin")).toBe("⌘⇧A")
    expect(formatShortcutAccelerator("CommandOrControl+Shift+A", "win32")).toBe("Ctrl + Shift + A")
    expect(formatShortcutAccelerator(null, "linux")).toBe("未设置")
  })
})
