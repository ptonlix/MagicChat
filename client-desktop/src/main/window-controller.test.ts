import { describe, expect, it } from "vitest"

import { getMainWindowTitleBarOptions } from "@main/window-controller"

describe("主窗口标题栏", () => {
  it("在 macOS 使用保留原生交通灯的内容式标题栏", () => {
    expect(getMainWindowTitleBarOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 13 },
    })
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
