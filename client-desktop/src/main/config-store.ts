import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { DesktopSettings, ServerProfile } from "@shared/bridge"

const CURRENT_SCHEMA = 1

export class UnsupportedConfigVersionError extends Error {
  constructor() {
    super("桌面配置来自更高版本，请重新安装较新版本的 MagicChat")
  }
}

type StoredConfig = {
  schemaVersion: number
  settings: DesktopSettings
  servers: ServerProfile[]
}

const defaultSettings: DesktopSettings = {
  autoLaunch: false,
  closeBehavior: "background",
  messageSoundEnabled: true,
  notificationPrivacy: "metadata",
}

export class ConfigStore {
  private config: StoredConfig = {
    schemaVersion: CURRENT_SCHEMA,
    settings: defaultSettings,
    servers: [],
  }
  private readonly filePath: string
  private operationQueue = Promise.resolve()

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "desktop-config.json")
  }

  async load(): Promise<void> {
    await this.enqueueOperation(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      let nextConfig: StoredConfig
      try {
        const raw = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoredConfig>
        nextConfig = migrate(raw)
      } catch (error) {
        if (error instanceof UnsupportedConfigVersionError) throw error
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          await rename(this.filePath, `${this.filePath}.invalid-${Date.now()}`).catch(
            () => undefined,
          )
        }
        nextConfig = {
          schemaVersion: CURRENT_SCHEMA,
          settings: defaultSettings,
          servers: [],
        }
      }
      await this.persist(nextConfig)
      this.config = nextConfig
    })
  }

  getSettings(): DesktopSettings {
    return structuredClone(this.config.settings)
  }

  async setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings> {
    return this.enqueueOperation(async () => {
      const next = { ...this.config.settings, ...patch }
      if (!(["background", "quit"] as const).includes(next.closeBehavior))
        throw new Error("关闭行为无效")
      if (typeof next.messageSoundEnabled !== "boolean") throw new Error("新消息提示音设置无效")
      if (!(["hidden", "metadata", "preview"] as const).includes(next.notificationPrivacy))
        throw new Error("通知隐私无效")
      const nextConfig = { ...this.config, settings: next }
      await this.persist(nextConfig)
      this.config = nextConfig
      return structuredClone(next)
    })
  }

  listServers(): ServerProfile[] {
    return structuredClone(this.config.servers)
  }

  server(id: string): ServerProfile | undefined {
    const value = this.config.servers.find((item) => item.id === id)
    return value ? structuredClone(value) : undefined
  }

  async addServer(input: Omit<ServerProfile, "id" | "createdAt">): Promise<ServerProfile> {
    return this.enqueueOperation(async () => {
      if (this.config.servers.some((item) => item.normalizedUrl === input.normalizedUrl)) {
        throw new Error("该服务器已经添加")
      }
      const profile: ServerProfile = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      }
      const nextConfig = { ...this.config, servers: [...this.config.servers, profile] }
      await this.persist(nextConfig)
      this.config = nextConfig
      return structuredClone(profile)
    })
  }

  async updateServer(
    id: string,
    patch: Partial<Pick<ServerProfile, "displayName" | "lastUserId">>,
  ): Promise<ServerProfile> {
    return this.enqueueOperation(async () => {
      const index = this.config.servers.findIndex((item) => item.id === id)
      if (index < 0) throw new Error("服务器不存在")
      const profile = { ...this.config.servers[index], ...patch }
      const servers = this.config.servers.map((item, itemIndex) =>
        itemIndex === index ? profile : item,
      )
      const nextConfig = { ...this.config, servers }
      await this.persist(nextConfig)
      this.config = nextConfig
      return structuredClone(profile)
    })
  }

  async revokeUser(id: string, userId: string): Promise<void> {
    await this.enqueueOperation(async () => {
      const index = this.config.servers.findIndex((item) => item.id === id)
      if (index < 0) throw new Error("服务器不存在")
      const current = this.config.servers[index]
      if (current.lastUserId !== userId) return
      const profile: ServerProfile = { ...current, lastUserId: undefined }
      const servers = this.config.servers.map((item, itemIndex) =>
        itemIndex === index ? profile : item,
      )
      const nextConfig = { ...this.config, servers }
      await this.persist(nextConfig)
      this.config = nextConfig
    })
  }

  async removeServer(id: string): Promise<void> {
    await this.enqueueOperation(async () => {
      const servers = this.config.servers.filter((item) => item.id !== id)
      const settings =
        this.config.settings.selectedServerId === id
          ? { ...this.config.settings, selectedServerId: undefined }
          : this.config.settings
      const nextConfig = { ...this.config, settings, servers }
      await this.persist(nextConfig)
      this.config = nextConfig
    })
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationQueue.then(operation)
    this.operationQueue = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  private async persist(config: StoredConfig): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

function migrate(raw: Partial<StoredConfig>): StoredConfig {
  if (raw.schemaVersion !== undefined && raw.schemaVersion > CURRENT_SCHEMA) {
    throw new UnsupportedConfigVersionError()
  }
  const servers = Array.isArray(raw.servers) ? raw.servers.filter(isServerProfile) : []
  const settings = normalizeSettings(raw.settings, servers)
  return { schemaVersion: CURRENT_SCHEMA, settings, servers }
}

function normalizeSettings(value: unknown, servers: ServerProfile[]): DesktopSettings {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const selectedServerId =
    typeof input.selectedServerId === "string" &&
    servers.some((server) => server.id === input.selectedServerId)
      ? input.selectedServerId
      : undefined

  return {
    autoLaunch:
      typeof input.autoLaunch === "boolean" ? input.autoLaunch : defaultSettings.autoLaunch,
    closeBehavior:
      input.closeBehavior === "background" || input.closeBehavior === "quit"
        ? input.closeBehavior
        : defaultSettings.closeBehavior,
    messageSoundEnabled:
      typeof input.messageSoundEnabled === "boolean"
        ? input.messageSoundEnabled
        : defaultSettings.messageSoundEnabled,
    notificationPrivacy:
      input.notificationPrivacy === "hidden" ||
      input.notificationPrivacy === "metadata" ||
      input.notificationPrivacy === "preview"
        ? input.notificationPrivacy
        : defaultSettings.notificationPrivacy,
    ...(selectedServerId ? { selectedServerId } : {}),
  }
}

function isServerProfile(value: unknown): value is ServerProfile {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return ["id", "normalizedUrl", "displayName", "createdAt"].every(
    (key) => typeof item[key] === "string",
  )
}
