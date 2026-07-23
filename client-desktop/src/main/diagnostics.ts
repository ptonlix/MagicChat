import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { app, crashReporter, dialog } from "electron"
import type { RendererRuntimeSnapshot } from "@shared/bridge"

type ResourceSnapshot = {
  processes: ReadonlyArray<{ cpuPercent: number; memoryMb: number; type: string }>
  system: { freeMemoryMb: number; totalMemoryMb: number }
}

type RendererSnapshot = RendererRuntimeSnapshot & { ageMs: number }
type RecordDetails = { durationMs?: number; episodeId?: string; resources?: ResourceSnapshot; runtime?: RendererSnapshot }

export const diagnosticLogMaxBytes = 5 * 1024 * 1024
export const runtimeStallCooldownMs = 30_000

export type DiagnosticRecord = {
  arch: string
  code: string
  durationMs?: number
  episodeId?: string
  platform: string
  processType: "gpu" | "main" | "renderer"
  resources?: ResourceSnapshot
  runtime?: RendererSnapshot
  timestamp: string
  version: string
}

export class Diagnostics {
  private readonly logPath: string
  private readonly rotatedLogPath: string
  private readonly maxLogBytes: number
  private readonly stallCooldownMs: number
  private lastRuntimeStallAt?: number
  private pendingRuntimeStall?: Required<Pick<RecordDetails, "durationMs" | "resources" | "runtime">>
  private persistenceEnabled = false
  private rendererRuntime?: { receivedAt: number; snapshot: RendererRuntimeSnapshot }
  private runtimeStallTimer?: ReturnType<typeof setTimeout>
  private writeQueue = Promise.resolve()

  constructor(
    userDataPath: string,
    options: { maxLogBytes?: number; stallCooldownMs?: number } = {}
  ) {
    this.logPath = path.join(userDataPath, "diagnostics", "crashes.jsonl")
    this.rotatedLogPath = `${this.logPath}.1`
    this.maxLogBytes = options.maxLogBytes ?? diagnosticLogMaxBytes
    this.stallCooldownMs = options.stallCooldownMs ?? runtimeStallCooldownMs
  }

  async initialize(): Promise<void> {
    this.persistenceEnabled = false
    try {
      await mkdir(path.dirname(this.logPath), { recursive: true })
      await repairTruncatedTail(this.logPath)
      this.persistenceEnabled = true
    } catch {
      // 诊断属于辅助能力，本地日志不可用时不能阻止客户端启动。
    }
    try {
      crashReporter.start({ companyName: "MagicChat", productName: "MagicChat", submitURL: "", uploadToServer: false, compress: false })
    } catch {
      // Crash Reporter 不可用时保留应用核心功能。
    }
  }

  async record(
    processType: DiagnosticRecord["processType"],
    code: string,
    details: RecordDetails = {}
  ): Promise<void> {
    if (!this.persistenceEnabled) return
    const record: DiagnosticRecord = {
      arch: process.arch,
      code: sanitizeCode(code),
      ...(Number.isFinite(details.durationMs)
        ? { durationMs: Math.max(0, Math.round(details.durationMs ?? 0)) }
        : {}),
      ...(details.episodeId ? { episodeId: details.episodeId.slice(0, 64) } : {}),
      platform: process.platform,
      processType,
      ...(details.resources ? { resources: details.resources } : {}),
      ...(details.runtime ? { runtime: details.runtime } : {}),
      timestamp: new Date().toISOString(),
      version: app.getVersion(),
    }
    const line = `${JSON.stringify(record)}\n`
    const write = this.writeQueue.then(() => this.appendRecord(line))
    this.writeQueue = write.catch(() => undefined)
    await write.catch(() => undefined)
  }

  updateRuntimeSnapshot(snapshot: RendererRuntimeSnapshot): void {
    this.rendererRuntime = { receivedAt: Date.now(), snapshot }
    if (this.persistenceEnabled && (snapshot.eventLoopLagMs >= 1_000 || snapshot.longTasks.maxDurationMs >= 1_000)) {
      this.queueRuntimeStall({
        durationMs: Math.max(snapshot.eventLoopLagMs, snapshot.longTasks.maxDurationMs),
        resources: collectResources(),
        runtime: { ...snapshot, ageMs: 0 },
      })
    }
  }

  async recordRendererLifecycle(code: string, episodeId: string, durationMs?: number): Promise<void> {
    if (!this.persistenceEnabled) return
    const runtime = this.rendererRuntime
      ? { ...this.rendererRuntime.snapshot, ageMs: Math.max(0, Date.now() - this.rendererRuntime.receivedAt) }
      : undefined
    await this.record("renderer", code, {
      durationMs,
      episodeId,
      resources: collectResources(),
      runtime,
    })
  }

  async export(): Promise<{ path?: string }> {
    const result = await dialog.showSaveDialog({ defaultPath: `MagicChat-diagnostics-${new Date().toISOString().slice(0, 10)}.json` })
    if (result.canceled || !result.filePath) return {}
    await this.flushPendingRuntimeStall()
    await this.writeQueue
    const records = await this.readRecords()
    const payload = {
      application: { arch: process.arch, build: process.env.MAGICCHAT_BUILD_ID ?? "local", channel: releaseChannel(), platform: process.platform, version: app.getVersion() },
      events: records,
      exportedAt: new Date().toISOString(),
      remoteTelemetryEnabled: false,
      schemaVersion: 3,
    }
    await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    return { path: result.filePath }
  }

  private async readRecords(): Promise<DiagnosticRecord[]> {
    try {
      const contents = await Promise.all([readOptional(this.rotatedLogPath), readOptional(this.logPath)])
      const lines = contents.join("\n").split("\n").filter(Boolean).slice(-200)
      return lines.flatMap((line) => {
        try {
          const record: unknown = JSON.parse(line)
          return isDiagnosticRecord(record) ? [record] : []
        } catch {
          return []
        }
      })
    } catch { return [] }
  }

  private async appendRecord(line: string): Promise<void> {
    await mkdir(path.dirname(this.logPath), { recursive: true })
    const currentSize = await stat(this.logPath).then((value) => value.size).catch(() => 0)
    if (currentSize > 0 && currentSize + Buffer.byteLength(line) > this.maxLogBytes) {
      await rm(this.rotatedLogPath, { force: true })
      await rename(this.logPath, this.rotatedLogPath)
    }
    await appendFile(this.logPath, line, { mode: 0o600 })
  }

  private queueRuntimeStall(details: Required<Pick<RecordDetails, "durationMs" | "resources" | "runtime">>): void {
    const now = Date.now()
    const cooldownElapsed = this.lastRuntimeStallAt === undefined || now - this.lastRuntimeStallAt >= this.stallCooldownMs
    if (cooldownElapsed) {
      const selected = !this.pendingRuntimeStall || details.durationMs >= this.pendingRuntimeStall.durationMs
        ? details
        : this.pendingRuntimeStall
      this.pendingRuntimeStall = undefined
      if (this.runtimeStallTimer) clearTimeout(this.runtimeStallTimer)
      this.runtimeStallTimer = undefined
      this.lastRuntimeStallAt = now
      void this.record("renderer", "renderer-runtime-stall", selected)
      return
    }

    if (!this.pendingRuntimeStall || details.durationMs >= this.pendingRuntimeStall.durationMs) {
      this.pendingRuntimeStall = details
    }
    if (this.runtimeStallTimer) return
    this.runtimeStallTimer = setTimeout(() => {
      void this.flushPendingRuntimeStall()
    }, Math.max(0, this.stallCooldownMs - (now - (this.lastRuntimeStallAt ?? now))))
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
    await this.record("renderer", "renderer-runtime-stall", pending)
  }
}

async function readOptional(filePath: string): Promise<string> {
  return readFile(filePath, "utf8").catch(() => "")
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

function collectResources(): ResourceSnapshot {
  const memory = process.getSystemMemoryInfo()
  return {
    processes: app.getAppMetrics().map((metric) => ({
      cpuPercent: bounded(metric.cpu.percentCPUUsage, 100_000),
      memoryMb: bounded(metric.memory.workingSetSize / 1024, 1_000_000),
      type: String(metric.type).slice(0, 32),
    })),
    system: {
      freeMemoryMb: bounded(memory.free / 1024, 1_000_000),
      totalMemoryMb: bounded(memory.total / 1024, 1_000_000),
    },
  }
}

function bounded(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))
}

export function releaseChannel(): "preview" | "stable" | "test" {
  const channel = process.env.MAGICCHAT_RELEASE_CHANNEL
  return channel === "stable" || channel === "preview" ? channel : "test"
}

function sanitizeCode(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[url]").replace(/[\\/][^\s]+/g, "[path]").slice(0, 160)
}

function isDiagnosticRecord(value: unknown): value is DiagnosticRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<DiagnosticRecord>
  return Boolean(
    typeof record.timestamp === "string" &&
      typeof record.version === "string" &&
      typeof record.processType === "string" &&
      typeof record.code === "string" &&
      record.code.length <= 160 &&
      (record.durationMs === undefined ||
        (Number.isFinite(record.durationMs) && (record.durationMs ?? -1) >= 0))
  )
}
