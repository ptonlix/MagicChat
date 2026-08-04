import { describe, expect, it } from "vitest"

import { acceleratorFromKeyboardEvent } from "@/lib/shortcut-recorder"

describe("快捷键录制转换", () => {
  it("转换 macOS 和 Windows 组合键", () => {
    expect(
      acceleratorFromKeyboardEvent(
        { altKey: false, code: "KeyS", ctrlKey: false, metaKey: true, shiftKey: true },
        "darwin",
      ),
    ).toBe("Command+Shift+S")
    expect(
      acceleratorFromKeyboardEvent(
        { altKey: true, code: "KeyS", ctrlKey: true, metaKey: false, shiftKey: false },
        "win32",
      ),
    ).toBe("Control+Alt+S")
  })

  it("拒绝没有主修饰键或只有修饰键的输入", () => {
    expect(
      acceleratorFromKeyboardEvent(
        { altKey: false, code: "KeyA", ctrlKey: false, metaKey: false, shiftKey: true },
        "darwin",
      ),
    ).toBeUndefined()
    expect(
      acceleratorFromKeyboardEvent(
        { altKey: false, code: "ShiftLeft", ctrlKey: true, metaKey: false, shiftKey: true },
        "win32",
      ),
    ).toBeUndefined()
  })
})
