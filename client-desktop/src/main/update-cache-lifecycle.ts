import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

type InstallIntent = Readonly<{
  schemaVersion: 1
  targetVersion: string
}>

type RemovePath = (target: string, options: Parameters<typeof rm>[1]) => Promise<void>

type UpdateCacheLifecycleOptions = Readonly<{
  currentVersion: string
  removePath?: RemovePath
  updaterCachePath: string
  userDataPath: string
}>

export type UpdateCacheCleanupResult =
  | "cleared"
  | "invalid_intent"
  | "no_intent"
  | "retry_pending"
  | "version_mismatch"

export class UpdateCacheLifecycle {
  private readonly currentVersion: string
  private readonly installIntentPath: string
  private readonly removePath: RemovePath
  private readonly updaterCachePath: string

  constructor(options: UpdateCacheLifecycleOptions) {
    this.currentVersion = options.currentVersion
    this.installIntentPath = path.join(options.userDataPath, "update-install-intent.json")
    this.removePath = options.removePath ?? rm
    this.updaterCachePath = options.updaterCachePath
  }

  async recordInstallIntent(targetVersion: string): Promise<void> {
    if (!isStableVersion(targetVersion)) throw new Error("更新目标版本无效")
    await mkdir(path.dirname(this.installIntentPath), { recursive: true })
    const temporaryPath = `${this.installIntentPath}.${randomUUID()}.tmp`
    try {
      const intent: InstallIntent = { schemaVersion: 1, targetVersion }
      await writeFile(temporaryPath, `${JSON.stringify(intent)}\n`, { mode: 0o600 })
      await rename(temporaryPath, this.installIntentPath)
    } catch (error) {
      await this.removePath(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async clearAfterHealthyStart(): Promise<UpdateCacheCleanupResult> {
    const intent = await this.readInstallIntent()
    if (intent === "absent") return "no_intent"
    if (intent === "invalid") {
      await this.discardInstallIntent()
      return "invalid_intent"
    }
    if (intent === "unreadable") return "retry_pending"
    if (intent.targetVersion !== this.currentVersion) return "version_mismatch"
    try {
      await this.removePath(this.updaterCachePath, { force: true, recursive: true })
    } catch {
      return "retry_pending"
    }
    return (await this.discardInstallIntent()) ? "cleared" : "retry_pending"
  }

  async discardInstallIntent(): Promise<boolean> {
    try {
      await this.removePath(this.installIntentPath, { force: true })
      return true
    } catch {
      return false
    }
  }

  private async readInstallIntent(): Promise<InstallIntent | "absent" | "invalid" | "unreadable"> {
    let contents: string
    try {
      contents = await readFile(this.installIntentPath, "utf8")
    } catch (error) {
      return errorCode(error) === "ENOENT" ? "absent" : "unreadable"
    }
    try {
      return parseInstallIntent(JSON.parse(contents)) ?? "invalid"
    } catch {
      return "invalid"
    }
  }
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("code" in value)) return undefined
  const code = value.code
  return typeof code === "string" ? code : undefined
}

function isStableVersion(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
}

function parseInstallIntent(value: unknown): InstallIntent | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    !("targetVersion" in value)
  )
    return undefined
  const { schemaVersion, targetVersion } = value
  if (schemaVersion !== 1 || !isStableVersion(targetVersion)) return undefined
  return { schemaVersion, targetVersion }
}
