import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { app, crashReporter, dialog } from "electron"

export type DiagnosticRecord = {
  arch: string
  code: string
  durationMs?: number
  platform: string
  processType: "gpu" | "main" | "renderer"
  timestamp: string
  version: string
}

export class Diagnostics {
  private readonly logPath: string

  constructor(private readonly userDataPath: string) {
    this.logPath = path.join(userDataPath, "diagnostics", "crashes.jsonl")
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.logPath), { recursive: true })
    crashReporter.start({ companyName: "MagicChat", productName: "MagicChat", submitURL: "", uploadToServer: false, compress: false })
  }

  async record(
    processType: DiagnosticRecord["processType"],
    code: string,
    details: { durationMs?: number } = {}
  ): Promise<void> {
    const record: DiagnosticRecord = {
      arch: process.arch,
      code: sanitizeCode(code),
      ...(Number.isFinite(details.durationMs)
        ? { durationMs: Math.max(0, Math.round(details.durationMs ?? 0)) }
        : {}),
      platform: process.platform,
      processType,
      timestamp: new Date().toISOString(),
      version: app.getVersion(),
    }
    await appendFile(this.logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 }).catch(() => undefined)
  }

  async export(): Promise<{ path?: string }> {
    const result = await dialog.showSaveDialog({ defaultPath: `MagicChat-diagnostics-${new Date().toISOString().slice(0, 10)}.json` })
    if (result.canceled || !result.filePath) return {}
    const records = await this.readRecords()
    const payload = {
      application: { arch: process.arch, build: process.env.MAGICCHAT_BUILD_ID ?? "local", channel: releaseChannel(), platform: process.platform, version: app.getVersion() },
      events: records,
      exportedAt: new Date().toISOString(),
      remoteTelemetryEnabled: false,
      schemaVersion: 2,
    }
    await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    return { path: result.filePath }
  }

  private async readRecords(): Promise<DiagnosticRecord[]> {
    try {
      const lines = (await readFile(this.logPath, "utf8")).split("\n").filter(Boolean).slice(-200)
      return lines.map((line) => JSON.parse(line) as DiagnosticRecord).filter(isDiagnosticRecord)
    } catch { return [] }
  }
}

export function releaseChannel(): "preview" | "stable" | "test" {
  const channel = process.env.MAGICCHAT_RELEASE_CHANNEL
  return channel === "stable" || channel === "preview" ? channel : "test"
}

function sanitizeCode(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[url]").replace(/[\\/][^\s]+/g, "[path]").slice(0, 160)
}

function isDiagnosticRecord(value: DiagnosticRecord): boolean {
  return Boolean(
    value.timestamp &&
      value.version &&
      value.processType &&
      value.code.length <= 160 &&
      (value.durationMs === undefined ||
        (Number.isFinite(value.durationMs) && value.durationMs >= 0))
  )
}
