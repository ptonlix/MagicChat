import { app, shell } from "electron"
import updaterModule from "electron-updater"
import type {
  UpdaterErrorCode,
  UpdaterInstallResult,
  UpdaterState,
  UpdaterStatus,
} from "@shared/bridge"
import { releaseChannel } from "@main/diagnostics"
import { determineUpdateEligibility, type UpdateEligibilityInput } from "@main/updater-eligibility"

const { autoUpdater } = updaterModule
const INITIAL_CHECK_DELAY = 60_000
const NORMAL_CHECK_DELAY = 6 * 60 * 60_000
const MINIMUM_RETRY_DELAY = 15 * 60_000
const MAXIMUM_RETRY_DELAY = 6 * 60 * 60_000
const MAXIMUM_RELEASE_NOTES_LENGTH = 4_000
const RELEASE_BASE_URL = "https://github.com/ptonlix/MagicChat/releases"

type UpdaterEvent =
  | "checking-for-update"
  | "download-progress"
  | "error"
  | "update-available"
  | "update-downloaded"
  | "update-not-available"

export type UpdaterAdapter = {
  allowDowngrade: boolean
  allowPrerelease: boolean
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  off(event: UpdaterEvent, listener: (payload?: unknown) => void): unknown
  on(event: UpdaterEvent, listener: (payload?: unknown) => void): unknown
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export type UpdaterClock = {
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
  random(): number
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
}

type UpdaterContext = UpdateEligibilityInput &
  Readonly<{
    currentVersion: string
  }>

type UpdaterServiceOptions = Readonly<{
  adapter?: UpdaterAdapter
  clock?: UpdaterClock
  context?: UpdaterContext
  hasActiveTransfers?: () => boolean
  openExternal?: (url: string) => Promise<void>
  prepareInstall?: () => Promise<void>
}>

const TRANSITIONS: Readonly<Record<UpdaterStatus, ReadonlySet<UpdaterStatus>>> = {
  available: new Set(["downloading", "error", "manual"]),
  checking: new Set(["available", "error", "idle", "manual"]),
  downloaded: new Set(["error", "installing", "manual"]),
  downloading: new Set(["downloaded", "error", "manual"]),
  error: new Set(["checking", "manual", "unsupported"]),
  idle: new Set(["checking", "manual", "unsupported"]),
  installing: new Set(["downloaded", "error", "manual"]),
  manual: new Set(["available", "checking", "error", "idle", "unsupported"]),
  unsupported: new Set(),
}

export class UpdaterService {
  private readonly adapter: UpdaterAdapter
  private readonly clock: UpdaterClock
  private readonly context: UpdaterContext
  private readonly eligibility: ReturnType<typeof determineUpdateEligibility>
  private readonly hasActiveTransfers: () => boolean
  private readonly listeners = new Set<(state: UpdaterState) => void>()
  private readonly openExternal: (url: string) => Promise<void>
  private readonly prepareInstall: () => Promise<void>
  private readonly updaterListeners: ReadonlyArray<
    readonly [UpdaterEvent, (payload?: unknown) => void]
  >
  private checkPromise?: Promise<UpdaterState>
  private disposed = false
  private downloadPromise?: Promise<void>
  private installIntent = false
  private retryCount = 0
  private state: UpdaterState
  private timer?: ReturnType<typeof setTimeout>

  constructor(options: UpdaterServiceOptions = {}) {
    this.adapter = options.adapter ?? electronUpdaterAdapter()
    this.clock = options.clock ?? systemClock()
    this.context = options.context ?? systemContext()
    this.eligibility = determineUpdateEligibility(this.context)
    this.hasActiveTransfers = options.hasActiveTransfers ?? (() => false)
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url))
    this.prepareInstall = options.prepareInstall ?? (async () => undefined)
    this.state = this.initialState()
    this.adapter.autoDownload = false
    this.adapter.autoInstallOnAppQuit = false
    this.adapter.allowPrerelease = false
    this.adapter.allowDowngrade = false
    this.updaterListeners = this.createUpdaterListeners()
    for (const [event, listener] of this.updaterListeners) this.adapter.on(event, listener)
    if (this.eligibility.canCheck) this.schedule(INITIAL_CHECK_DELAY)
  }

  subscribe(listener: (state: UpdaterState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  check(): Promise<UpdaterState> {
    if (this.disposed || !this.eligibility.canCheck) return Promise.resolve(this.state)
    if (this.checkPromise) return this.checkPromise
    if (!this.canTransition("checking")) return Promise.resolve(this.state)
    this.clearTimer()
    this.transition({ ...this.baseState(), status: "checking" })
    this.checkPromise = this.adapter
      .checkForUpdates()
      .catch((error: unknown) => {
        this.handleError(error)
      })
      .then(() => this.state)
      .finally(() => {
        this.checkPromise = undefined
        this.scheduleAfterOperation()
      })
    return this.checkPromise
  }

  download(): Promise<void> {
    if (this.disposed || this.eligibility.mode !== "ota" || this.state.status !== "available") {
      return Promise.resolve()
    }
    if (this.downloadPromise) return this.downloadPromise
    this.transition({ ...this.state, progress: 0, status: "downloading" })
    this.downloadPromise = this.adapter
      .downloadUpdate()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.handleError(error)
      })
      .finally(() => {
        this.downloadPromise = undefined
      })
    return this.downloadPromise
  }

  async install(): Promise<UpdaterInstallResult> {
    if (this.disposed || this.state.status !== "downloaded") {
      return { reason: "not_downloaded", status: "blocked" }
    }
    if (this.hasActiveTransfers()) {
      return { reason: "active_transfers", status: "blocked" }
    }
    if (this.installIntent) return { reason: "install_in_progress", status: "blocked" }
    this.installIntent = true
    this.transition({ ...this.state, retryable: false, status: "installing" })
    try {
      await this.prepareInstall()
      this.adapter.quitAndInstall(false, true)
      return { status: "started" }
    } catch (error) {
      this.installIntent = false
      this.handleError(error)
      return { reason: "prepare_failed", status: "failed" }
    }
  }

  async openManualDownload(): Promise<void> {
    const version = this.state.targetVersion
    const url = version
      ? `${RELEASE_BASE_URL}/tag/desktop-v${version}`
      : `${RELEASE_BASE_URL}/latest`
    await this.openExternal(url)
  }

  current(): UpdaterState {
    return this.state
  }

  isInstallIntent(): boolean {
    return this.installIntent
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTimer()
    for (const [event, listener] of this.updaterListeners) this.adapter.off(event, listener)
    this.listeners.clear()
  }

  private initialState(): UpdaterState {
    const status =
      this.eligibility.mode === "unsupported"
        ? "unsupported"
        : this.eligibility.canCheck
          ? "idle"
          : "manual"
    return { ...this.baseState(), status }
  }

  private baseState(): Omit<UpdaterState, "status"> {
    return {
      currentVersion: this.context.currentVersion,
      installMode: this.eligibility.mode,
      installationSource: this.eligibility.installationSource,
      manualAction: this.manualAction(),
      retryable: false,
    }
  }

  private manualAction(): UpdaterState["manualAction"] {
    if (this.eligibility.mode === "unsupported") return undefined
    const label =
      this.context.platform === "darwin"
        ? "下载 DMG"
        : this.context.platform === "linux"
          ? this.eligibility.installationSource === "deb"
            ? "下载 deb"
            : "下载 AppImage"
          : "下载安装包"
    return { label }
  }

  private createUpdaterListeners(): ReadonlyArray<
    readonly [UpdaterEvent, (payload?: unknown) => void]
  > {
    return [
      ["checking-for-update", () => this.transition({ ...this.baseState(), status: "checking" })],
      ["update-available", (payload) => this.handleAvailable(payload)],
      ["update-not-available", () => this.handleNotAvailable()],
      ["download-progress", (payload) => this.handleProgress(payload)],
      ["update-downloaded", (payload) => this.handleDownloaded(payload)],
      ["error", (payload) => this.handleError(payload)],
    ]
  }

  private handleAvailable(payload: unknown): void {
    const info = updateInfo(payload)
    if (!info || !isStableVersion(info.version)) {
      this.handleError(new Error("metadata invalid"))
      return
    }
    this.retryCount = 0
    this.transition({
      ...this.baseState(),
      manualAction: this.manualAction(),
      releaseNotes: sanitizeReleaseNotes(info.releaseNotes),
      retryable: this.eligibility.mode === "ota",
      status: "available",
      targetVersion: info.version,
    })
  }

  private handleNotAvailable(): void {
    this.retryCount = 0
    this.transition({ ...this.baseState(), status: "idle" })
  }

  private handleProgress(payload: unknown): void {
    if (this.state.status !== "downloading") return
    const percent = progressPercent(payload)
    if (percent === undefined) return
    const previous = this.state.progress ?? 0
    this.transition({ ...this.state, progress: Math.max(previous, percent), status: "downloading" })
  }

  private handleDownloaded(payload: unknown): void {
    if (this.state.status !== "downloading") return
    const info = updateInfo(payload)
    this.transition({
      ...this.state,
      progress: 100,
      retryable: true,
      status: "downloaded",
      targetVersion: info?.version ?? this.state.targetVersion,
    })
  }

  private handleError(error: unknown): void {
    if (this.disposed || this.state.status === "error" || !this.canTransition("error")) return
    const errorCode = classifyUpdateError(error)
    this.retryCount += 1
    this.transition({
      ...this.state,
      errorCode,
      retryable: true,
      status: "error",
    })
  }

  private transition(next: UpdaterState): boolean {
    if (this.disposed || (next.status !== this.state.status && !this.canTransition(next.status))) {
      return false
    }
    this.state = next
    for (const listener of this.listeners) listener(next)
    return true
  }

  private canTransition(status: UpdaterStatus): boolean {
    return status === this.state.status || TRANSITIONS[this.state.status].has(status)
  }

  private scheduleAfterOperation(): void {
    if (this.disposed || !this.eligibility.canCheck) return
    if (this.state.status === "error") {
      const exponential = Math.min(
        MAXIMUM_RETRY_DELAY,
        MINIMUM_RETRY_DELAY * 2 ** Math.max(0, this.retryCount - 1),
      )
      this.schedule(Math.min(MAXIMUM_RETRY_DELAY, exponential * (1 + this.clock.random() * 0.2)))
      return
    }
    if (this.state.status === "idle") this.schedule(NORMAL_CHECK_DELAY)
  }

  private schedule(delay: number): void {
    this.clearTimer()
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      void this.check()
    }, delay)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (!this.timer) return
    this.clock.clearTimeout(this.timer)
    this.timer = undefined
  }
}

export function sanitizeReleaseNotes(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value
            .map((entry) =>
              entry &&
              typeof entry === "object" &&
              "note" in entry &&
              typeof entry.note === "string"
                ? entry.note
                : "",
            )
            .join("\n")
        : ""
  const sanitized = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, "[链接已移除]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAXIMUM_RELEASE_NOTES_LENGTH)
  return sanitized || undefined
}

export function classifyUpdateError(error: unknown): UpdaterErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (/rate.?limit|status code 429/.test(message)) return "rate_limited"
  if (/signature|codesign|gatekeeper|squirrel.*code/.test(message))
    return "platform_signature_required"
  if (/sha|checksum|digest/.test(message)) return "checksum_invalid"
  if (/metadata|yaml|parse|version/.test(message)) return "metadata_invalid"
  if (/platform|architecture|arch mismatch/.test(message)) return "platform_mismatch"
  if (/enospc|disk.*full|no space/.test(message)) return "disk_full"
  if (/eacces|eperm|permission|read-only/.test(message)) return "permission_denied"
  if (/network|timeout|timed out|offline|econn|enotfound/.test(message)) return "network"
  return "update_failed"
}

function updateInfo(value: unknown): { releaseNotes?: unknown; version: string } | undefined {
  if (!value || typeof value !== "object" || !("version" in value)) return undefined
  const version = value.version
  if (typeof version !== "string") return undefined
  return { releaseNotes: "releaseNotes" in value ? value.releaseNotes : undefined, version }
}

function progressPercent(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || !("percent" in value)) return undefined
  const percent = value.percent
  return typeof percent === "number" && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : undefined
}

function isStableVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
}

function systemContext(): UpdaterContext {
  return {
    appImagePath: process.env.APPIMAGE,
    arch: process.arch,
    channel: releaseChannel(),
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
  }
}

function systemClock(): UpdaterClock {
  return {
    clearTimeout: (timer) => clearTimeout(timer),
    random: () => Math.random(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
  }
}

function electronUpdaterAdapter(): UpdaterAdapter {
  return {
    get allowDowngrade() {
      return autoUpdater.allowDowngrade
    },
    set allowDowngrade(value) {
      autoUpdater.allowDowngrade = value
    },
    get allowPrerelease() {
      return autoUpdater.allowPrerelease
    },
    set allowPrerelease(value) {
      autoUpdater.allowPrerelease = value
    },
    get autoDownload() {
      return autoUpdater.autoDownload
    },
    set autoDownload(value) {
      autoUpdater.autoDownload = value
    },
    get autoInstallOnAppQuit() {
      return autoUpdater.autoInstallOnAppQuit
    },
    set autoInstallOnAppQuit(value) {
      autoUpdater.autoInstallOnAppQuit = value
    },
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    off: (event, listener) => autoUpdater.off(event, listener),
    on: (event, listener) => autoUpdater.on(event, listener),
    quitAndInstall: (isSilent, isForceRunAfter) =>
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
  }
}
