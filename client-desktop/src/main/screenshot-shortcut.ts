import { globalShortcut } from "electron"
import type { Diagnostics } from "@main/diagnostics"
import type { ScreenshotController } from "@main/screenshot-controller"
import type { WindowController } from "@main/window-controller"
import { IPC } from "@shared/bridge"

export const SCREENSHOT_SHORTCUT = "CommandOrControl+Shift+A"

type ScreenshotShortcutDependencies = Readonly<{
  diagnostics: Pick<Diagnostics, "record">
  screenshots: Pick<ScreenshotController, "start">
  windows: Pick<WindowController, "send" | "show">
}>

export function registerScreenshotShortcut({
  diagnostics,
  screenshots,
  windows,
}: ScreenshotShortcutDependencies): () => void {
  const registered = globalShortcut.register(SCREENSHOT_SHORTCUT, () => {
    void screenshots
      .start({})
      .then((result) => {
        if (result.status !== "error") return
        windows.show()
        windows.send(IPC.screenshotStartFailed, { code: result.code })
      })
      .catch(() => {
        windows.show()
        windows.send(IPC.screenshotStartFailed, { code: "capture_failed" })
      })
  })

  if (!registered) void diagnostics.record("main", "screenshot-shortcut-unavailable")

  return () => globalShortcut.unregister(SCREENSHOT_SHORTCUT)
}
