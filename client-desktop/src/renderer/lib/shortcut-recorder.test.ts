import { describe, expect, it } from "vitest"

import {
  acceleratorFromKeyboardEvent,
  acceleratorMatchesKeyboardEvent,
} from "@/lib/shortcut-recorder"

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

describe("快捷键匹配", () => {
  it("仅在没有修饰键时匹配 Enter 发送预设", () => {
    expect(
      acceleratorMatchesKeyboardEvent("Enter", {
        altKey: false,
        code: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true)
    expect(
      acceleratorMatchesKeyboardEvent("Enter", {
        altKey: false,
        code: "Enter",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(false)
  })

  it("CommandOrControl 同时接受 Cmd 或 Ctrl", () => {
    expect(
      acceleratorMatchesKeyboardEvent("CommandOrControl+Enter", {
        altKey: false,
        code: "Enter",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(true)
    expect(
      acceleratorMatchesKeyboardEvent("CommandOrControl+Enter", {
        altKey: false,
        code: "Enter",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true)
  })

  it("精确匹配 Command 与 Control 组合", () => {
    expect(
      acceleratorMatchesKeyboardEvent("Command+Enter", {
        altKey: false,
        code: "Enter",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(true)
    expect(
      acceleratorMatchesKeyboardEvent("Control+Enter", {
        altKey: false,
        code: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false)
  })

  it("拒绝按键、修饰键或 Shift 不匹配的组合", () => {
    expect(
      acceleratorMatchesKeyboardEvent("CommandOrControl+Enter", {
        altKey: false,
        code: "Enter",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe(false)
    expect(
      acceleratorMatchesKeyboardEvent("CommandOrControl+Enter", {
        altKey: false,
        code: "Digit1",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false)
    expect(
      acceleratorMatchesKeyboardEvent("无效组合", {
        altKey: false,
        code: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false)
  })
})
