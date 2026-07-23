import { app } from "electron"
import updaterModule from "electron-updater"
import type { UpdaterState } from "../shared/bridge"
import { releaseChannel } from "./diagnostics"

const { autoUpdater } = updaterModule

export class UpdaterService {
  private state: UpdaterState = { status: "idle" }
  private readonly listeners = new Set<(state: UpdaterState) => void>()
  private timer?: NodeJS.Timeout

  constructor() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = releaseChannel() === "preview"
    autoUpdater.on("checking-for-update", () => this.set({ status: "checking" }))
    autoUpdater.on("update-available", (info) => this.set({ status: "available", version: info.version }))
    autoUpdater.on("update-not-available", () => this.set({ status: "idle" }))
    autoUpdater.on("download-progress", (progress) => this.set({ ...this.state, progress: progress.percent, status: "downloading" }))
    autoUpdater.on("update-downloaded", (info) => this.set({ status: "downloaded", version: info.version }))
    autoUpdater.on("error", (error) => this.set({ errorCode: classifyUpdateError(error), status: "error" }))
    if (app.isPackaged && releaseChannel() !== "test") this.schedule(60_000)
  }

  subscribe(listener: (state: UpdaterState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async check(): Promise<UpdaterState> {
    if (!app.isPackaged || releaseChannel() === "test") return this.set({ status: "manual" })
    if (process.platform === "linux" && !process.env.APPIMAGE) return this.set({ status: "manual" })
    try { await autoUpdater.checkForUpdates() } catch { /* 状态由 error 事件更新。 */ }
    return this.state
  }

  async download(): Promise<void> { await autoUpdater.downloadUpdate() }

  install(): void {
    if (this.state.status !== "downloaded") throw new Error("更新尚未下载完成")
    autoUpdater.quitAndInstall(false, true)
  }

  current(): UpdaterState { return this.state }

  private set(state: UpdaterState): UpdaterState { this.state = state; for (const listener of this.listeners) listener(state); return state }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      await this.check()
      this.schedule(this.state.status === "error" ? 15 * 60_000 : 6 * 60 * 60_000)
    }, delay)
    this.timer.unref()
  }
}

function classifyUpdateError(error: Error): string {
  const message = error.message.toLowerCase()
  if (message.includes("signature")) return "signature_invalid"
  if (message.includes("sha") || message.includes("checksum")) return "checksum_invalid"
  if (message.includes("network") || message.includes("timeout")) return "network"
  return "update_failed"
}
