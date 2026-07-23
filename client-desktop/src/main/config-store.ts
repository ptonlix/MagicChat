import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { DesktopSettings, ServerProfile } from "../shared/bridge"

const CURRENT_SCHEMA = 1

export class UnsupportedConfigVersionError extends Error {
  constructor() { super("桌面配置来自更高版本，请重新安装较新版本的 MagicChat") }
}

type StoredConfig = {
  schemaVersion: number
  settings: DesktopSettings
  servers: ServerProfile[]
}

const defaultSettings: DesktopSettings = {
  autoLaunch: false,
  closeBehavior: "background",
  notificationPrivacy: "metadata",
}

export class ConfigStore {
  private config: StoredConfig = { schemaVersion: CURRENT_SCHEMA, settings: defaultSettings, servers: [] }
  private readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "desktop-config.json")
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoredConfig>
      this.config = migrate(raw)
      await this.persist()
    } catch (error) {
      if (error instanceof UnsupportedConfigVersionError) throw error
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await rename(this.filePath, `${this.filePath}.invalid-${Date.now()}`).catch(() => undefined)
      }
      this.config = { schemaVersion: CURRENT_SCHEMA, settings: defaultSettings, servers: [] }
      await this.persist()
    }
  }

  getSettings(): DesktopSettings {
    return structuredClone(this.config.settings)
  }

  async setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings> {
    const next = { ...this.config.settings, ...patch }
    if (!(["background", "quit"] as const).includes(next.closeBehavior)) throw new Error("关闭行为无效")
    if (!(["hidden", "metadata", "preview"] as const).includes(next.notificationPrivacy)) throw new Error("通知隐私无效")
    this.config.settings = next
    await this.persist()
    return this.getSettings()
  }

  listServers(): ServerProfile[] {
    return structuredClone(this.config.servers)
  }

  server(id: string): ServerProfile | undefined {
    const value = this.config.servers.find((item) => item.id === id)
    return value ? structuredClone(value) : undefined
  }

  async addServer(input: Omit<ServerProfile, "id" | "createdAt">): Promise<ServerProfile> {
    if (this.config.servers.some((item) => item.normalizedUrl === input.normalizedUrl)) {
      throw new Error("该服务器已经添加")
    }
    const profile: ServerProfile = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }
    this.config.servers.push(profile)
    await this.persist()
    return structuredClone(profile)
  }

  async updateServer(id: string, patch: Partial<Pick<ServerProfile, "displayName" | "lastUserId">>): Promise<ServerProfile> {
    const index = this.config.servers.findIndex((item) => item.id === id)
    if (index < 0) throw new Error("服务器不存在")
    this.config.servers[index] = { ...this.config.servers[index], ...patch }
    await this.persist()
    return structuredClone(this.config.servers[index])
  }

  async removeServer(id: string): Promise<void> {
    this.config.servers = this.config.servers.filter((item) => item.id !== id)
    if (this.config.settings.selectedServerId === id) {
      this.config.settings = { ...this.config.settings, selectedServerId: undefined }
    }
    await this.persist()
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.config, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }
}

function migrate(raw: Partial<StoredConfig>): StoredConfig {
  if (raw.schemaVersion !== undefined && raw.schemaVersion > CURRENT_SCHEMA) {
    throw new UnsupportedConfigVersionError()
  }
  const servers = Array.isArray(raw.servers) ? raw.servers.filter(isServerProfile) : []
  const settings = { ...defaultSettings, ...(raw.settings ?? {}) }
  return { schemaVersion: CURRENT_SCHEMA, settings, servers }
}

function isServerProfile(value: unknown): value is ServerProfile {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return ["id", "normalizedUrl", "displayName", "createdAt"].every((key) => typeof item[key] === "string")
}
