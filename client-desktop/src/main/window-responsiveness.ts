import { dialog, type BrowserWindow } from "electron"
import { randomUUID } from "node:crypto"

import type { Diagnostics } from "@main/diagnostics"
import type { DiagnosticDataForType } from "@shared/diagnostics-contract"

export const unresponsivePromptDelayMs = 8_000

export function monitorWindowResponsiveness(
  window: BrowserWindow,
  diagnostics: Diagnostics,
  promptDelayMs = unresponsivePromptDelayMs,
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

  const recordPhase = (
    phase: DiagnosticDataForType<"window.unresponsive">["windowResponsivenessPhase"],
    currentEpisodeId: string,
    durationMs?: number,
  ) => {
    void diagnostics.recordEvent({
      context: { episodeId: currentEpisodeId },
      data: {
        ...(durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(durationMs)) }),
        windowResponsivenessPhase: phase,
      },
      origin: "main",
      type: "window.unresponsive",
    })
  }

  window.on("unresponsive", () => {
    if (startedAt !== undefined) return
    startedAt = Date.now()
    episodeId = randomUUID()
    recordPhase("detected", episodeId)
    promptTimer = setTimeout(() => {
      promptTimer = undefined
      if (startedAt === undefined || window.isDestroyed()) return
      const controller = new AbortController()
      promptController = controller
      const currentEpisodeId = episodeId
      if (!currentEpisodeId) return
      recordPhase("prompted", currentEpisodeId, Date.now() - startedAt)
      void dialog
        .showMessageBox(window, {
          type: "warning",
          buttons: ["继续等待", "重新加载"],
          defaultId: 0,
          cancelId: 0,
          message: "MagicChat 暂时没有响应",
          detail: "应用仍在处理数据。你可以继续等待，或重新加载当前窗口。",
          signal: controller.signal,
        })
        .then((result) => {
          if (episodeId !== currentEpisodeId || startedAt === undefined || window.isDestroyed())
            return
          const action = result.response === 1 ? "reload" : "wait"
          recordPhase(
            action === "reload" ? "reloaded" : "waited",
            currentEpisodeId,
            Date.now() - startedAt,
          )
          if (result.response === 1) {
            window.webContents.reload()
          }
        })
        .catch((error: unknown) => {
          if (episodeId !== currentEpisodeId || startedAt === undefined) return
          if (!(error instanceof Error) || error.name !== "AbortError") {
            recordPhase("prompt-failed", currentEpisodeId, Date.now() - startedAt)
          }
        })
        .finally(() => {
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
    if (currentEpisodeId) recordPhase("recovered", currentEpisodeId, durationMs)
  })

  window.on("closed", () => {
    if (startedAt !== undefined && episodeId) {
      recordPhase("closed", episodeId, Date.now() - startedAt)
    }
    clearPrompt()
  })
}
