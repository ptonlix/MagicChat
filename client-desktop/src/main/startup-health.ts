import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

type HealthState = {
  schemaVersion: 1
  startedAt: string
  status: "healthy" | "starting"
  version: string
}

export class StartupHealth {
  private readonly filePath: string
  private current?: HealthState

  constructor(userDataPath: string, private readonly version: string) {
    this.filePath = path.join(userDataPath, "startup-health.json")
  }

  async begin(): Promise<{ previousStartupIncomplete: boolean }> {
    const previous = await this.read()
    this.current = { schemaVersion: 1, startedAt: new Date().toISOString(), status: "starting", version: this.version }
    await this.persist(this.current)
    return { previousStartupIncomplete: previous?.status === "starting" }
  }

  async markHealthy(): Promise<void> {
    if (!this.current || this.current.status === "healthy") return
    this.current = { ...this.current, status: "healthy" }
    await this.persist(this.current)
  }

  private async read(): Promise<HealthState | undefined> {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<HealthState>
      if (value.schemaVersion === 1 && (value.status === "healthy" || value.status === "starting") && typeof value.startedAt === "string" && typeof value.version === "string") {
        return value as HealthState
      }
    } catch { /* 缺失或损坏的健康文件不阻止应用启动。 */ }
    return undefined
  }

  private async persist(value: HealthState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }
}
