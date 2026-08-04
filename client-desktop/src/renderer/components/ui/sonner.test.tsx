import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"

import { SettingsCenter } from "@/components/settings/settings-center"
import { Toaster } from "@/components/ui/sonner"
import { showScreenshotStartError } from "@/lib/screenshot-start-error"
import type { DesktopBridge, ServerProfile } from "@shared/bridge"

const profile: ServerProfile = {
  createdAt: "2026-08-04T00:00:00.000Z",
  displayName: "测试服务器",
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
}

describe("Toaster", () => {
  afterEach(() => toast.dismiss())

  it("关闭按钮使用中文名称并关闭提示", async () => {
    render(<Toaster />)

    act(() => {
      toast.warning("需要开启屏幕录制权限", {
        closeButton: true,
        duration: Infinity,
      })
    })

    const closeButton = await screen.findByRole("button", { name: "关闭提示" })
    const styles = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")

    expect(document.querySelector(".lucide-triangle-alert")).not.toBeNull()
    expect(document.querySelector(".lucide-octagon-x")).toBeNull()
    expect(closeButton).toHaveClass("desktop-toast-close")
    expect(styles).toMatch(
      /\.cn-toast,[\s\S]*\.desktop-toast-close[\s\S]*-webkit-app-region:\s*no-drag/,
    )
    fireEvent.click(closeButton)

    await waitFor(() => expect(screen.queryByText("需要开启屏幕录制权限")).not.toBeInTheDocument())
  })

  it("设置窗口打开时仍可操作截图权限提示", async () => {
    const openSettings = vi.fn().mockResolvedValue(true)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        permissions: { openSettings, request: vi.fn() },
      } satisfies Pick<DesktopBridge, "permissions">,
    })
    render(
      <>
        <SettingsCenter
          activeSection="general"
          profile={profile}
          onOpenChange={() => undefined}
          onSectionChange={() => undefined}
        >
          <span>设置内容</span>
        </SettingsCenter>
        <Toaster />
      </>,
    )

    act(() => showScreenshotStartError("permission_denied"))

    fireEvent.click(await screen.findByRole("button", { name: "前往设置" }))
    expect(openSettings).toHaveBeenCalledWith("screen")
    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }))
    await waitFor(() => expect(screen.queryByText(/截图需要屏幕录制权限/)).not.toBeInTheDocument())

    const styles = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")
    expect(styles).toMatch(/\[data-sonner-toaster\]\s*\{[^}]*pointer-events:\s*auto !important/)
  })
})
