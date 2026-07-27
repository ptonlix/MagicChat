import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {},
  Menu: {},
  nativeImage: {},
  session: {},
  systemPreferences: {},
  Tray: vi.fn(),
}))

import { prepareTrayImage, runtimeTrayIconPath } from "@main/system-integration"

describe("prepareTrayImage", () => {
  it("macOS 使用透明背景的菜单栏专用图标", () => {
    expect(runtimeTrayIconPath("darwin")).toContain("trayTemplate.png")
    expect(runtimeTrayIconPath("win32")).toContain("logo.png")
  })

  it("在 macOS 上使用跟随菜单栏颜色的模板图标", () => {
    const resizedImage = { setTemplateImage: vi.fn() }
    const image = { resize: vi.fn(() => resizedImage) }

    expect(
      prepareTrayImage(image as unknown as Parameters<typeof prepareTrayImage>[0], "darwin"),
    ).toBe(resizedImage)
    expect(image.resize).toHaveBeenCalledWith({ height: 20, width: 20 })
    expect(resizedImage.setTemplateImage).toHaveBeenCalledWith(true)
  })

  it("在 Windows 和 Linux 上保留彩色图标", () => {
    const resizedImage = { setTemplateImage: vi.fn() }
    const image = { resize: vi.fn(() => resizedImage) }

    prepareTrayImage(image as unknown as Parameters<typeof prepareTrayImage>[0], "win32")

    expect(resizedImage.setTemplateImage).not.toHaveBeenCalled()
  })
})
