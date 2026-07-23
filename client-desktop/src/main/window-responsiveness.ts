import { dialog, type BrowserWindow } from "electron"

import type { Diagnostics } from "@main/diagnostics"

export const unresponsivePromptDelayMs = 8_000

export function monitorWindowResponsiveness(
  window: BrowserWindow,
  diagnostics: Diagnostics,
  promptDelayMs = unresponsivePromptDelayMs
): void {
  let startedAt: number | undefined
  let promptTimer: ReturnType<typeof setTimeout> | undefined
  let promptController: AbortController | undefined

  const clearPrompt = () => {
    if (promptTimer) clearTimeout(promptTimer)
    promptTimer = undefined
    promptController?.abort()
    promptController = undefined
  }

  window.on("unresponsive", () => {
    if (startedAt !== undefined) return
    startedAt = Date.now()
    void diagnostics.record("renderer", "unresponsive")
    promptTimer = setTimeout(() => {
      promptTimer = undefined
      if (startedAt === undefined || window.isDestroyed()) return
      const controller = new AbortController()
      promptController = controller
      void dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["继续等待", "重新加载"],
        defaultId: 0,
        cancelId: 0,
        message: "MagicChat 暂时没有响应",
        detail: "应用仍在处理数据。你可以继续等待，或重新加载当前窗口。",
        signal: controller.signal,
      }).then((result) => {
        if (result.response === 1 && startedAt !== undefined && !window.isDestroyed()) {
          window.webContents.reload()
        }
      }).finally(() => {
        if (promptController === controller) promptController = undefined
      })
    }, promptDelayMs)
  })

  window.on("responsive", () => {
    if (startedAt === undefined) return
    const durationMs = Date.now() - startedAt
    startedAt = undefined
    clearPrompt()
    void diagnostics.record("renderer", "responsive", { durationMs })
  })

  window.on("closed", clearPrompt)
}
