import { describe, expect, it, vi } from "vitest"

import {
  getMainWindowTitleBarOptions,
  hideNativeWindowButtons,
  setTrustedWindowTheme,
} from "@main/window-controller"
import { DESKTOP_TITLEBAR_HEIGHT } from "@shared/bridge"

describe("主窗口标题栏", () => {
  it("在 macOS 隐藏原生交通灯，由应用内控件负责窗口操作", () => {
    expect(getMainWindowTitleBarOptions("darwin")).toEqual({
      titleBarStyle: "hidden",
    })
  })

  it.each(["win32", "linux"] as const)("在 %s 使用系统窗口控制键覆盖层", (platform) => {
    expect(getMainWindowTitleBarOptions(platform)).toEqual({
      titleBarOverlay: {
        color: "#00000000",
        height: DESKTOP_TITLEBAR_HEIGHT,
        symbolColor: "#18181b",
      },
      titleBarStyle: "hidden",
    })
  })

  it("深色主题同步窗口背景和系统控制键颜色", () => {
    const window = { setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() }

    setTrustedWindowTheme(window, true, "win32")

    expect(window.setBackgroundColor).toHaveBeenCalledWith("#09090b")
    expect(window.setTitleBarOverlay).toHaveBeenCalledWith({
      color: "#00000000",
      height: DESKTOP_TITLEBAR_HEIGHT,
      symbolColor: "#fafafa",
    })
  })

  it("仅在 macOS 隐藏原生交通灯", () => {
    const window = { setWindowButtonVisibility: vi.fn() }

    hideNativeWindowButtons(window, "darwin")
    hideNativeWindowButtons(window, "win32")

    expect(window.setWindowButtonVisibility).toHaveBeenCalledOnce()
    expect(window.setWindowButtonVisibility).toHaveBeenCalledWith(false)
  })
})
