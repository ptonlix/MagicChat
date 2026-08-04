import { globalShortcut } from "electron"
import type { ConfigStore } from "@main/config-store"
import type { Diagnostics } from "@main/diagnostics"
import type { ScreenshotController } from "@main/screenshot-controller"
import type { WindowController } from "@main/window-controller"
import { IPC } from "@shared/bridge"
import {
  DEFAULT_SCREENSHOT_SHORTCUT,
  normalizeShortcutAccelerator,
  type ScreenshotShortcutState,
  type ScreenshotShortcutUpdateResult,
} from "@shared/shortcut-contract"

export const SCREENSHOT_SHORTCUT = DEFAULT_SCREENSHOT_SHORTCUT

type ShortcutRegistrar = Pick<typeof globalShortcut, "register" | "unregister">

type ScreenshotShortcutDependencies = Readonly<{
  diagnostics: Pick<Diagnostics, "record">
  registrar?: ShortcutRegistrar
  screenshots: Pick<ScreenshotController, "start">
  store: Pick<ConfigStore, "getSettings" | "setSettings">
  windows: Pick<WindowController, "send" | "show">
}>

export class ScreenshotShortcutManager {
  private accelerator: string | null
  private disposed = false
  private recordingOwnerId: number | undefined
  private registered = false
  private readonly dependencies: ScreenshotShortcutDependencies
  private readonly registrar: ShortcutRegistrar

  constructor(dependencies: ScreenshotShortcutDependencies) {
    this.dependencies = dependencies
    this.registrar = dependencies.registrar ?? globalShortcut
    this.accelerator = dependencies.store.getSettings().screenshotShortcut
  }

  start(): ScreenshotShortcutState {
    this.assertActive()
    this.registerCurrent()
    return this.getState()
  }

  getState(): ScreenshotShortcutState {
    return {
      accelerator: this.accelerator,
      recording: this.recordingOwnerId !== undefined,
      registered: this.registered,
    }
  }

  beginRecording(ownerId: number): ScreenshotShortcutState {
    this.assertActive()
    if (this.recordingOwnerId !== undefined && this.recordingOwnerId !== ownerId) {
      throw new Error("其他窗口正在录制快捷键")
    }
    this.recordingOwnerId = ownerId
    this.unregisterCurrent()
    return this.getState()
  }

  cancelRecording(ownerId: number): ScreenshotShortcutState {
    this.assertRecordingOwner(ownerId)
    this.recordingOwnerId = undefined
    this.registerCurrent()
    return this.getState()
  }

  releaseOwner(ownerId: number): void {
    if (this.recordingOwnerId !== ownerId || this.disposed) return
    this.recordingOwnerId = undefined
    this.registerCurrent()
  }

  async setScreenshot(ownerId: number, value: unknown): Promise<ScreenshotShortcutUpdateResult> {
    this.assertActive()
    if (this.recordingOwnerId !== undefined && this.recordingOwnerId !== ownerId) {
      throw new Error("快捷键录制窗口无效")
    }
    const candidate = value === null ? null : normalizeShortcutAccelerator(value)
    const previous = this.accelerator
    const wasRecording = this.recordingOwnerId === ownerId

    if (candidate === previous) {
      this.recordingOwnerId = undefined
      if (!this.registered) this.registerCurrent()
      return {
        state: this.getState(),
        status: this.registered || candidate === null ? "updated" : "conflict",
      }
    }

    if (candidate === null) {
      try {
        await this.dependencies.store.setSettings({ screenshotShortcut: null })
      } catch {
        const restored = !wasRecording || this.restoreAfterRecording()
        return { state: this.getState(), status: restored ? "save_failed" : "restore_failed" }
      }
      this.unregisterCurrent()
      this.accelerator = null
      this.recordingOwnerId = undefined
      return { state: this.getState(), status: "updated" }
    }

    if (!this.registrar.register(candidate, this.handleShortcut)) {
      const restored = !wasRecording || this.restoreAfterRecording()
      void this.dependencies.diagnostics.record("main", "screenshot-shortcut-unavailable")
      return { state: this.getState(), status: restored ? "conflict" : "restore_failed" }
    }

    try {
      await this.dependencies.store.setSettings({ screenshotShortcut: candidate })
    } catch {
      this.registrar.unregister(candidate)
      const restored = !wasRecording || this.restoreAfterRecording()
      return { state: this.getState(), status: restored ? "save_failed" : "restore_failed" }
    }

    this.unregisterCurrent()
    this.accelerator = candidate
    this.registered = true
    this.recordingOwnerId = undefined
    return { state: this.getState(), status: "updated" }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unregisterCurrent()
    this.recordingOwnerId = undefined
  }

  private readonly handleShortcut = () => {
    void this.dependencies.screenshots
      .start({})
      .then((result) => {
        if (result.status !== "error") return
        this.dependencies.windows.show()
        this.dependencies.windows.send(IPC.screenshotStartFailed, { code: result.code })
      })
      .catch(() => {
        this.dependencies.windows.show()
        this.dependencies.windows.send(IPC.screenshotStartFailed, { code: "capture_failed" })
      })
  }

  private registerCurrent(): void {
    if (!this.accelerator || this.registered || this.disposed) return
    this.registered = this.registrar.register(this.accelerator, this.handleShortcut)
    if (!this.registered) {
      void this.dependencies.diagnostics.record("main", "screenshot-shortcut-unavailable")
    }
  }

  private unregisterCurrent(): void {
    if (!this.accelerator || !this.registered) return
    this.registrar.unregister(this.accelerator)
    this.registered = false
  }

  private restoreAfterRecording(): boolean {
    this.recordingOwnerId = undefined
    this.registerCurrent()
    return this.registered || this.accelerator === null
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("快捷键管理器已关闭")
  }

  private assertRecordingOwner(ownerId: number): void {
    this.assertActive()
    if (this.recordingOwnerId !== ownerId) throw new Error("快捷键录制窗口无效")
  }
}
