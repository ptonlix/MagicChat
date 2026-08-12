import { randomUUID } from "node:crypto"
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { app, crashReporter, dialog } from "electron"
import {
  DIAGNOSTIC_SCHEMA_VERSION,
  parseDiagnosticEvent,
  parseDiagnosticEventInput,
  type DiagnosticEvent,
  type DiagnosticEventInput,
  type DiagnosticStorageStats,
  type DiagnosticType,
} from "@shared/diagnostics-contract"
import type { RendererRuntimeSnapshot } from "@shared/bridge"

type RuntimeStallDetails = {
  durationMs?: number
  memoryMb: number
  runtime?: RendererRuntimeSnapshot
}
type DiagnosticsState = { eventSeq: number; rotationCount: number }
export type DiagnosticEpisodeReason =
  | "connection"
  | "locked"
  | "reconnect"
  | "resume"
  | "suspend"
  | "window"

export const diagnosticLogMaxBytes = 5 * 1024 * 1024
export const runtimeStallCooldownMs = 30_000

export type DiagnosticRecord = DiagnosticEvent

export class Diagnostics {
  private readonly logPath: string
  private readonly rotatedLogPath: string
  private readonly statePath: string
  private readonly maxLogBytes: number
  private readonly stallCooldownMs: number
  private currentEpisodeId?: string
  private currentEpisodeReason?: DiagnosticEpisodeReason
  private lastRuntimeStallAt?: number
  private pendingRuntimeStall?: Required<RuntimeStallDetails>
  private persistenceEnabled = false
  private rendererRuntime?: { receivedAt: number; snapshot: RendererRuntimeSnapshot }
  private runtimeStallTimer?: ReturnType<typeof setTimeout>
  private state: DiagnosticsState = { eventSeq: 0, rotationCount: 0 }
  private writeQueue = Promise.resolve()

  constructor(
    userDataPath: string,
    options: { maxLogBytes?: number; stallCooldownMs?: number } = {},
  ) {
    this.logPath = path.join(userDataPath, "diagnostics", "realtime.jsonl")
    this.rotatedLogPath = `${this.logPath}.1`
    this.statePath = path.join(userDataPath, "diagnostics", "realtime-state.json")
    this.maxLogBytes = options.maxLogBytes ?? diagnosticLogMaxBytes
    this.stallCooldownMs = options.stallCooldownMs ?? runtimeStallCooldownMs
  }

  async initialize(): Promise<void> {
    this.persistenceEnabled = false
    try {
      await mkdir(path.dirname(this.logPath), { recursive: true })
      await removeObsoleteDiagnosticLogs(path.dirname(this.logPath)).catch(() => undefined)
      await Promise.all([
        repairTruncatedTail(this.logPath),
        repairTruncatedTail(this.rotatedLogPath),
      ])
      const state = await readState(this.statePath)
      const records = await this.readRecords()
      const lastEventSeq = records.reduce(
        (maximum, record) => Math.max(maximum, record.eventSeq),
        0,
      )
      this.state = {
        eventSeq: Math.max(state.eventSeq, lastEventSeq),
        rotationCount: state.rotationCount,
      }
      this.persistenceEnabled = true
    } catch {
      // 诊断属于辅助能力，本地日志不可用时不能阻止客户端启动。
    }
    try {
      crashReporter.start({
        companyName: "MagicChat",
        productName: "MagicChat",
        submitURL: "",
        uploadToServer: false,
        compress: false,
      })
    } catch {
      // Crash Reporter 不可用时保留应用核心功能。
    }
  }

  async recordEvent(input: DiagnosticEventInput): Promise<DiagnosticRecord | undefined> {
    if (!this.persistenceEnabled) return undefined
    let recorded: DiagnosticRecord | undefined
    const write = this.writeQueue.then(async () => {
      const normalized = parseDiagnosticEventInput(input)
      const contextualized =
        this.currentEpisodeId && !normalized.context?.episodeId
          ? {
              ...normalized,
              context: { ...normalized.context, episodeId: this.currentEpisodeId },
            }
          : normalized
      const eventSeq = this.state.eventSeq + 1
      const event: DiagnosticRecord = {
        ...contextualized,
        ...(contextualized.type === "realtime.parse-failures-aggregated"
          ? {
              data: {
                ...contextualized.data,
                suppressedToEventSeq: eventSeq,
              },
            }
          : {}),
        eventSeq,
        timestamp: new Date().toISOString(),
      }
      await this.appendRecord(`${JSON.stringify(event)}\n`)
      this.state.eventSeq = event.eventSeq
      await this.writeState()
      recorded = event
    })
    this.writeQueue = write.catch(() => undefined)
    await write.catch(() => undefined)
    return recorded
  }

  createEpisode(reason: DiagnosticEpisodeReason): string {
    const episodeId = randomUUID().replace(/-/g, "")
    this.currentEpisodeId = episodeId
    this.currentEpisodeReason = reason
    void this.recordEvent({
      context: { episodeId },
      data: { reason },
      origin: "main",
      type: "environment.lifecycle-changed",
    })
    return episodeId
  }

  getCurrentEpisodeId(): string | undefined {
    return this.currentEpisodeId
  }

  updateRuntimeSnapshot(snapshot: RendererRuntimeSnapshot): void {
    this.rendererRuntime = { receivedAt: Date.now(), snapshot }
    if (
      this.persistenceEnabled &&
      (snapshot.eventLoopLagMs >= 1_000 || snapshot.longTasks.maxDurationMs >= 1_000)
    ) {
      this.queueRuntimeStall({
        durationMs: Math.max(snapshot.eventLoopLagMs, snapshot.longTasks.maxDurationMs),
        memoryMb: systemFreeMemoryMb(),
        runtime: snapshot,
      })
    }
  }

  async export(): Promise<{ path?: string }> {
    const result = await dialog.showSaveDialog({
      defaultPath: `MagicChat-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    })
    if (result.canceled || !result.filePath) return {}
    await this.flushPendingRuntimeStall()
    await this.writeQueue
    const events = await this.readRecords()
    const payload = {
      application: {
        arch: process.arch,
        build: process.env.MAGICCHAT_BUILD_ID ?? "local",
        channel: releaseChannel(),
        platform: process.platform,
        version: app.getVersion(),
      },
      clientEvidenceBoundary:
        "客户端未观察到对应事件不代表服务端未发送；服务端发送情况不在本诊断包的证据范围内。",
      events,
      exportedAt: new Date().toISOString(),
      remoteTelemetryEnabled: false,
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      summary: summarize(events),
      timeline: timeline(events, this.state.rotationCount),
    }
    await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    return { path: result.filePath }
  }

  async getStorageStats(): Promise<DiagnosticStorageStats> {
    await this.writeQueue
    return this.readStorageStats()
  }

  async clearStorage(): Promise<DiagnosticStorageStats> {
    if (!this.persistenceEnabled) return this.readStorageStats()
    await this.flushPendingRuntimeStall()
    const clear = this.writeQueue.then(async () => {
      await Promise.all(
        [this.logPath, this.rotatedLogPath].map((filePath) => rm(filePath, { force: true })),
      )
      this.state.rotationCount = 0
      await this.writeState()
    })
    this.writeQueue = clear.catch(() => undefined)
    await clear
    return this.readStorageStats()
  }

  private async readStorageStats(): Promise<DiagnosticStorageStats> {
    if (!this.persistenceEnabled) return { bytes: 0, status: "unavailable" }
    try {
      const bytes = (
        await Promise.all([this.logPath, this.rotatedLogPath].map(diagnosticLogSize))
      ).reduce((total, size) => total + size, 0)
      if (!Number.isSafeInteger(bytes)) throw new Error("诊断日志大小超出安全范围")
      return { bytes, status: "available" }
    } catch {
      return { bytes: 0, status: "unavailable" }
    }
  }

  private async readRecords(): Promise<DiagnosticRecord[]> {
    try {
      const contents = await Promise.all([
        readOptional(this.rotatedLogPath),
        readOptional(this.logPath),
      ])
      return contents
        .flatMap((content) => content.split("\n").filter(Boolean))
        .flatMap((line) => {
          try {
            return [parseDiagnosticEvent(JSON.parse(line) as unknown)]
          } catch {
            return []
          }
        })
        .sort((left, right) => left.eventSeq - right.eventSeq)
    } catch {
      return []
    }
  }

  private async appendRecord(line: string): Promise<void> {
    await mkdir(path.dirname(this.logPath), { recursive: true })
    const currentSize = await stat(this.logPath)
      .then((value) => value.size)
      .catch(() => 0)
    if (currentSize > 0 && currentSize + Buffer.byteLength(line) > this.maxLogBytes) {
      await rm(this.rotatedLogPath, { force: true })
      await rename(this.logPath, this.rotatedLogPath)
      this.state.rotationCount += 1
    }
    await appendFile(this.logPath, line, { mode: 0o600 })
  }

  private async writeState(): Promise<void> {
    const temporaryPath = `${this.statePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(this.state), { mode: 0o600 })
    await rename(temporaryPath, this.statePath)
  }

  private queueRuntimeStall(details: Required<RuntimeStallDetails>): void {
    const now = Date.now()
    const cooldownElapsed =
      this.lastRuntimeStallAt === undefined || now - this.lastRuntimeStallAt >= this.stallCooldownMs
    if (cooldownElapsed) {
      const selected =
        !this.pendingRuntimeStall || details.durationMs >= this.pendingRuntimeStall.durationMs
          ? details
          : this.pendingRuntimeStall
      this.pendingRuntimeStall = undefined
      if (this.runtimeStallTimer) clearTimeout(this.runtimeStallTimer)
      this.runtimeStallTimer = undefined
      this.lastRuntimeStallAt = now
      void this.recordRuntimeStall(selected)
      return
    }

    if (!this.pendingRuntimeStall || details.durationMs >= this.pendingRuntimeStall.durationMs) {
      this.pendingRuntimeStall = details
    }
    if (this.runtimeStallTimer) return
    this.runtimeStallTimer = setTimeout(
      () => {
        void this.flushPendingRuntimeStall()
      },
      Math.max(0, this.stallCooldownMs - (now - (this.lastRuntimeStallAt ?? now))),
    )
    const timer = this.runtimeStallTimer as unknown as { unref?: () => void }
    timer.unref?.()
  }

  private async flushPendingRuntimeStall(): Promise<void> {
    if (this.runtimeStallTimer) clearTimeout(this.runtimeStallTimer)
    this.runtimeStallTimer = undefined
    const pending = this.pendingRuntimeStall
    this.pendingRuntimeStall = undefined
    if (!pending) return
    this.lastRuntimeStallAt = Date.now()
    await this.recordRuntimeStall(pending)
  }

  private async recordRuntimeStall(details: Required<RuntimeStallDetails>): Promise<void> {
    await this.recordEvent({
      ...(this.currentEpisodeId ? { context: { episodeId: this.currentEpisodeId } } : {}),
      data: {
        appActivatedAgeMs: bounded(details.runtime.appActivatedAgeMs ?? 0, 86_400_000),
        documentVisibility: details.runtime.documentVisibility ?? "hidden",
        durationMs: bounded(details.durationMs, 600_000),
        eventLoopLagMs: bounded(details.runtime.eventLoopLagMs, 600_000),
        longTaskCount: bounded(details.runtime.longTasks.count, 100_000),
        longTaskMaxDurationMs: bounded(details.runtime.longTasks.maxDurationMs, 600_000),
        memoryMb: bounded(details.memoryMb, 1_000_000),
        navigatorOnline: details.runtime.navigatorOnline ?? false,
        ...(this.currentEpisodeReason ? { reason: this.currentEpisodeReason } : {}),
        windowFocused: details.runtime.windowFocused ?? false,
        windowMinimized: details.runtime.windowMinimized ?? false,
        windowVisible: details.runtime.windowVisible ?? false,
      },
      origin: "renderer",
      type: "runtime.stall-observed",
    })
  }
}

function timeline(events: ReadonlyArray<DiagnosticRecord>, rotationCount: number) {
  return {
    eventCount: events.length,
    firstEventSeq: events[0]?.eventSeq,
    firstTimestamp: events[0]?.timestamp,
    lastEventSeq: events.at(-1)?.eventSeq,
    lastTimestamp: events.at(-1)?.timestamp,
    rotationCount,
  }
}

function summarize(events: ReadonlyArray<DiagnosticRecord>) {
  const byType: Record<string, number> = {}
  const connectionCounters = {
    authorizationFailures: 0,
    closes: 0,
    reconnects: 0,
    systemReady: 0,
  }
  const errorCategories: Record<string, number> = {}
  const episodes = new Map<string, string>()
  const syncOperations = new Map<string, string>()
  let suppressedCount = 0
  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1
    if (event.type === "realtime.socket-closed") connectionCounters.closes += 1
    if (event.type === "realtime.reconnect-scheduled") connectionCounters.reconnects += 1
    if (event.type === "realtime.system-ready") connectionCounters.systemReady += 1
    if (event.type === "realtime.authorization-checked" && event.data?.responseStatus === 401)
      connectionCounters.authorizationFailures += 1
    const error = event.data?.error
    if (error && typeof error === "object" && typeof error.category === "string")
      errorCategories[error.category] = (errorCategories[error.category] ?? 0) + 1
    if (event.context?.episodeId) episodes.set(event.context.episodeId, event.type)
    if (event.context?.syncOperationId && isSyncOutcome(event.type))
      syncOperations.set(event.context.syncOperationId, event.type)
    if (event.type === "realtime.parse-failures-aggregated")
      suppressedCount +=
        typeof event.data?.suppressedCount === "number" ? event.data.suppressedCount : 0
  }
  return {
    connectionCounters,
    episodeCount: episodes.size,
    errorCategories,
    eventTypes: byType,
    parseFailuresSuppressed: suppressedCount,
    syncOperationResults: Object.values(Object.fromEntries(syncOperations)).reduce<
      Record<string, number>
    >((result, outcome) => ({ ...result, [outcome]: (result[outcome] ?? 0) + 1 }), {}),
  }
}

function isSyncOutcome(type: DiagnosticType): boolean {
  return (
    type === "message-sync.completed" ||
    type === "message-sync.failed" ||
    type === "message-sync.cancelled" ||
    type === "message-sync.skipped"
  )
}

async function readState(filePath: string): Promise<DiagnosticsState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"))
    if (!parsed || typeof parsed !== "object") return { eventSeq: 0, rotationCount: 0 }
    const value = parsed as Partial<DiagnosticsState>
    return {
      eventSeq:
        Number.isSafeInteger(value.eventSeq) && (value.eventSeq ?? -1) >= 0 ? value.eventSeq! : 0,
      rotationCount:
        Number.isSafeInteger(value.rotationCount) && (value.rotationCount ?? -1) >= 0
          ? value.rotationCount!
          : 0,
    }
  } catch {
    return { eventSeq: 0, rotationCount: 0 }
  }
}

async function readOptional(filePath: string): Promise<string> {
  return readFile(filePath, "utf8").catch(() => "")
}

async function diagnosticLogSize(filePath: string): Promise<number> {
  try {
    const file = await stat(filePath)
    if (!file.isFile() || !Number.isSafeInteger(file.size) || file.size < 0)
      throw new Error("诊断日志文件状态无效")
    return file.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
    throw error
  }
}

async function repairTruncatedTail(filePath: string): Promise<void> {
  let file
  try {
    file = await open(filePath, "r+")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }

  try {
    const { size } = await file.stat()
    if (size === 0) return
    const chunkSize = 4 * 1024
    let end = size
    while (end > 0) {
      const start = Math.max(0, end - chunkSize)
      const buffer = Buffer.allocUnsafe(end - start)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
      const newlineIndex = buffer.lastIndexOf(0x0a, bytesRead - 1)
      if (newlineIndex >= 0) {
        const completeSize = start + newlineIndex + 1
        if (completeSize < size) await file.truncate(completeSize)
        return
      }
      end = start
    }
    await file.truncate(0)
  } finally {
    await file.close()
  }
}

function systemFreeMemoryMb(): number {
  const memory = process.getSystemMemoryInfo()
  return bounded(memory.free / 1024, 1_000_000)
}

function bounded(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))
}

async function removeObsoleteDiagnosticLogs(diagnosticsDirectory: string): Promise<void> {
  await Promise.all(
    ["crashes.jsonl", "crashes.jsonl.1"].map((fileName) =>
      rm(path.join(diagnosticsDirectory, fileName), { force: true }),
    ),
  )
}

export function releaseChannel(): "preview" | "stable" | "test" {
  const channel = process.env.MAGICCHAT_RELEASE_CHANNEL
  return channel === "stable" || channel === "preview" ? channel : "test"
}
