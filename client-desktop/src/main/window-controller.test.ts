import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  configureMainWindowButtons,
  getMainWindowTitleBarOptions,
  usesCustomWindowControls,
} from "@main/window-controller"

describe("主窗口标题栏", () => {
  it("在 macOS 保留系统窗口表面并隐藏标题栏", () => {
    expect(getMainWindowTitleBarOptions("darwin")).toEqual({
      roundedCorners: true,
      titleBarStyle: "hidden",
    })
  })

  it("在 macOS 根据当前页面切换原生交通灯", () => {
    const window = { setWindowButtonVisibility: vi.fn() }

    configureMainWindowButtons(window, "darwin", false)
    configureMainWindowButtons(window, "darwin", true)

    expect(window.setWindowButtonVisibility).toHaveBeenNthCalledWith(1, false)
    expect(window.setWindowButtonVisibility).toHaveBeenNthCalledWith(2, true)
  })

  it.each(["win32", "linux"] as const)("在 %s 保留系统窗口按钮", (platform) => {
    const window = { setWindowButtonVisibility: vi.fn() }

    configureMainWindowButtons(window, platform, false)

    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled()
  })

  it("只在主应用页面使用自定义窗口按钮", () => {
    expect(usesCustomWindowControls("magicchat-app://app/")).toBe(true)
    expect(usesCustomWindowControls("magicchat-app://app/index.html")).toBe(true)
    expect(usesCustomWindowControls("magicchat-app://app/login")).toBe(true)
    expect(usesCustomWindowControls("magicchat-app://app/chat/conversation-1")).toBe(true)
    expect(usesCustomWindowControls("magicchat-app://app/recovery.html")).toBe(false)
    expect(usesCustomWindowControls("magicchat-app://app/proxy-auth.html")).toBe(false)
    expect(usesCustomWindowControls("magicchat-app://app/assets/index.js")).toBe(false)
    expect(usesCustomWindowControls("http://localhost:20050/chat", "http://localhost:20050/")).toBe(
      true,
    )
    expect(usesCustomWindowControls("http://localhost:20051/chat", "http://localhost:20050/")).toBe(
      false,
    )
    expect(
      usesCustomWindowControls(
        "http://localhost:20050.evil.example/chat",
        "http://localhost:20050/",
      ),
    ).toBe(false)
    expect(usesCustomWindowControls("not a url", "http://localhost:20050/")).toBe(false)
  })

  it("恢复页提供独立的窗口拖动区域", async () => {
    const source = await readFile(path.resolve(process.cwd(), "src/renderer/recovery.html"), "utf8")

    expect(source).toContain("-webkit-app-region: drag")
    expect(source).toContain("-webkit-app-region: no-drag")
  })

  it.each(["win32", "linux"] as const)("在 %s 使用系统窗口控制键覆盖层", (platform) => {
    expect(getMainWindowTitleBarOptions(platform)).toEqual({
      titleBarOverlay: {
        color: "#00000000",
        height: 40,
        symbolColor: "#18181b",
      },
      titleBarStyle: "hidden",
    })
  })
})
