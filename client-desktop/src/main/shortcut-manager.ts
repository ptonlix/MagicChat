import { globalShortcut } from "electron"
import type { ConfigStore } from "@main/config-store"
import type { Diagnostics } from "@main/diagnostics"
import type { ScreenshotController } from "@main/screenshot-controller"
import type { WindowController } from "@main/window-controller"
import { IPC } from "@shared/bridge"
import {
  DEFAULT_SCREENSHOT_SHORTCUT,
  DEFAULT_SEARCH_SHORTCUT,
  DEFAULT_SEND_MESSAGE_SHORTCUT,
  normalizeShortcutAccelerator,
  type ShortcutKind,
  type ShortcutState,
  type ShortcutUpdateResult,
} from "@shared/shortcut-contract"

export const SCREENSHOT_SHORTCUT = DEFAULT_SCREENSHOT_SHORTCUT

export const SEARCH_SHORTCUT = DEFAULT_SEARCH_SHORTCUT

export const SEND_MESSAGE_SHORTCUT = DEFAULT_SEND_MESSAGE_SHORTCUT

const GLOBAL_KINDS = new Set<ShortcutKind>(["screenshot", "search"])

type ShortcutRegistrar = Pick<typeof globalShortcut, "register" | "unregister">

type ShortcutDependencies = Readonly<{
  diagnostics: Pick<Diagnostics, "record">
  registrar?: ShortcutRegistrar
  screenshots: Pick<ScreenshotController, "start">
  store: Pick<ConfigStore, "getSettings" | "setSettings">
  windows: Pick<WindowController, "send" | "show">
}>

export class ShortcutManager {
  private accelerators: Record<ShortcutKind, string | null>
  private disposed = false
  private recordingKind: ShortcutKind | undefined
  private recordingOwnerId: number | undefined
  private registered: Record<ShortcutKind, boolean> = {
    screenshot: false,
    search: false,
    sendMessage: false,
  }
  private readonly dependencies: ShortcutDependencies
  private readonly registrar: ShortcutRegistrar

  constructor(dependencies: ShortcutDependencies) {
    this.dependencies = dependencies
    this.registrar = dependencies.registrar ?? globalShortcut
    const settings = dependencies.store.getSettings()
    this.accelerators = {
      screenshot: settings.screenshotShortcut,
      search: settings.searchShortcut,
      sendMessage: settings.sendMessageShortcut,
    }
  }

  start(): Record<ShortcutKind, ShortcutState> {
    this.assertActive()
    this.registerCurrent("screenshot")
    this.registerCurrent("search")
    return {
      screenshot: this.getState("screenshot"),
      search: this.getState("search"),
      sendMessage: this.getState("sendMessage"),
    }
  }

  getState(kind: ShortcutKind): ShortcutState {
    return {
      accelerator: this.accelerators[kind],
      recording: this.recordingKind === kind,
      registered: this.registered[kind],
    }
  }

  beginRecording(ownerId: number, kind: ShortcutKind): ShortcutState {
    this.assertActive()
    if (this.recordingOwnerId !== undefined && this.recordingOwnerId !== ownerId) {
      throw new Error("其他窗口正在录制快捷键")
    }
    this.switchRecordingKind(kind)
    this.recordingOwnerId = ownerId
    this.recordingKind = kind
    this.unregisterCurrent(kind)
    return this.getState(kind)
  }

  cancelRecording(ownerId: number): ShortcutState {
    this.assertRecordingOwner(ownerId)
    const kind = this.recordingKind
    this.recordingOwnerId = undefined
    this.recordingKind = undefined
    if (kind) this.registerCurrent(kind)
    return this.getState(kind ?? "screenshot")
  }

  releaseOwner(ownerId: number): void {
    if (this.recordingOwnerId !== ownerId || this.disposed) return
    const kind = this.recordingKind
    this.recordingOwnerId = undefined
    this.recordingKind = undefined
    if (kind) this.registerCurrent(kind)
  }

  async set(kind: ShortcutKind, ownerId: number, value: unknown): Promise<ShortcutUpdateResult> {
    this.assertActive()
    if (this.recordingOwnerId !== undefined && this.recordingOwnerId !== ownerId) {
      throw new Error("快捷键录制窗口无效")
    }
    const candidate = value === null ? null : normalizeShortcutAccelerator(value)
    const previous = this.accelerators[kind]
    const wasRecording = this.recordingOwnerId === ownerId
    const global = isGlobalKind(kind)

    if (wasRecording) this.switchRecordingKind(kind)

    if (candidate === previous) {
      this.recordingOwnerId = undefined
      this.recordingKind = undefined
      if (!this.registered[kind]) this.registerCurrent(kind)
      return {
        state: this.getState(kind),
        status: !global || this.registered[kind] || candidate === null ? "updated" : "conflict",
      }
    }

    if (candidate === null) {
      try {
        await this.setStored(kind, null)
      } catch {
        const restored = !wasRecording || this.restoreAfterRecording(kind)
        return { state: this.getState(kind), status: restored ? "save_failed" : "restore_failed" }
      }
      this.unregisterCurrent(kind)
      this.accelerators[kind] = null
      this.recordingOwnerId = undefined
      this.recordingKind = undefined
      return { state: this.getState(kind), status: "updated" }
    }

    if (global && !this.registrar.register(candidate, this.handlerFor(kind))) {
      const restored = !wasRecording || this.restoreAfterRecording(kind)
      void this.dependencies.diagnostics.record("main", `${kind}-shortcut-unavailable`)
      return { state: this.getState(kind), status: restored ? "conflict" : "restore_failed" }
    }

    try {
      await this.setStored(kind, candidate)
    } catch {
      if (global) this.registrar.unregister(candidate)
      const restored = !wasRecording || this.restoreAfterRecording(kind)
      return { state: this.getState(kind), status: restored ? "save_failed" : "restore_failed" }
    }

    this.unregisterCurrent(kind)
    this.accelerators[kind] = candidate
    this.registered[kind] = global
    this.recordingOwnerId = undefined
    this.recordingKind = undefined
    return { state: this.getState(kind), status: "updated" }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unregisterCurrent("screenshot")
    this.unregisterCurrent("search")
    this.recordingOwnerId = undefined
    this.recordingKind = undefined
  }

  private readonly handleScreenshot = () => {
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

  private readonly handleSearch = () => {
    this.dependencies.windows.show()
    this.dependencies.windows.send(IPC.searchOpen)
  }

  private handlerFor(kind: ShortcutKind): () => void {
    return kind === "search" ? this.handleSearch : this.handleScreenshot
  }

  private async setStored(kind: ShortcutKind, value: string | null): Promise<void> {
    if (kind === "screenshot") {
      await this.dependencies.store.setSettings({ screenshotShortcut: value })
    } else if (kind === "search") {
      await this.dependencies.store.setSettings({ searchShortcut: value })
    } else {
      await this.dependencies.store.setSettings({ sendMessageShortcut: value })
    }
  }

  private registerCurrent(kind: ShortcutKind): void {
    if (!isGlobalKind(kind) || !this.accelerators[kind] || this.registered[kind] || this.disposed)
      return
    this.registered[kind] = this.registrar.register(this.accelerators[kind]!, this.handlerFor(kind))
    if (!this.registered[kind]) {
      void this.dependencies.diagnostics.record("main", `${kind}-shortcut-unavailable`)
    }
  }

  private unregisterCurrent(kind: ShortcutKind): void {
    if (!isGlobalKind(kind) || !this.accelerators[kind] || !this.registered[kind]) return
    this.registrar.unregister(this.accelerators[kind]!)
    this.registered[kind] = false
  }

  private restoreAfterRecording(kind: ShortcutKind): boolean {
    this.recordingOwnerId = undefined
    this.recordingKind = undefined
    this.registerCurrent(kind)
    return this.registered[kind] || this.accelerators[kind] === null
  }

  private switchRecordingKind(kind: ShortcutKind): void {
    if (
      this.recordingKind !== undefined &&
      this.recordingKind !== kind &&
      this.recordingOwnerId !== undefined
    ) {
      this.registerCurrent(this.recordingKind)
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("快捷键管理器已关闭")
  }

  private assertRecordingOwner(ownerId: number): void {
    this.assertActive()
    if (this.recordingOwnerId !== ownerId) throw new Error("快捷键录制窗口无效")
  }
}

function isGlobalKind(kind: ShortcutKind): boolean {
  return GLOBAL_KINDS.has(kind)
}
