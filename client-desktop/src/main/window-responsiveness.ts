import { dialog, type BrowserWindow } from "electron"
import { randomUUID } from "node:crypto"

import type { Diagnostics } from "@main/diagnostics"

export const unresponsivePromptDelayMs = 8_000

export function monitorWindowResponsiveness(
  window: BrowserWindow,
  diagnostics: Diagnostics,
  promptDelayMs = unresponsivePromptDelayMs
): void {
  let startedAt: number | undefined
  let episodeId: string | undefined
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
    episodeId = randomUUID()
    void diagnostics.recordRendererLifecycle("unresponsive", episodeId)
    promptTimer = setTimeout(() => {
      promptTimer = undefined
      if (startedAt === undefined || window.isDestroyed()) return
      const controller = new AbortController()
      promptController = controller
      const currentEpisodeId = episodeId
      if (!currentEpisodeId) return
      void diagnostics.recordRendererLifecycle("unresponsive-prompt", currentEpisodeId, Date.now() - startedAt)
      void dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["继续等待", "重新加载"],
        defaultId: 0,
        cancelId: 0,
        message: "MagicChat 暂时没有响应",
        detail: "应用仍在处理数据。你可以继续等待，或重新加载当前窗口。",
        signal: controller.signal,
      }).then((result) => {
        if (episodeId !== currentEpisodeId || startedAt === undefined || window.isDestroyed()) return
        const action = result.response === 1 ? "reload" : "wait"
        void diagnostics.recordRendererLifecycle(`unresponsive-${action}`, currentEpisodeId, Date.now() - startedAt)
        if (result.response === 1) {
          window.webContents.reload()
        }
      }).catch((error: unknown) => {
        if (episodeId !== currentEpisodeId || startedAt === undefined) return
        if (!(error instanceof Error) || error.name !== "AbortError") {
          void diagnostics.recordRendererLifecycle("unresponsive-prompt-error", currentEpisodeId, Date.now() - startedAt)
        }
      }).finally(() => {
        if (promptController === controller) promptController = undefined
      })
    }, promptDelayMs)
  })

  window.on("responsive", () => {
    if (startedAt === undefined) return
    const durationMs = Date.now() - startedAt
    const currentEpisodeId = episodeId
    startedAt = undefined
    episodeId = undefined
    clearPrompt()
    if (currentEpisodeId) void diagnostics.recordRendererLifecycle("responsive", currentEpisodeId, durationMs)
  })

  window.on("closed", () => {
    if (startedAt !== undefined && episodeId) {
      void diagnostics.recordRendererLifecycle("unresponsive-window-closed", episodeId, Date.now() - startedAt)
    }
    clearPrompt()
  })
}
