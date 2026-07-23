import { app, session } from "electron"
import { normalizeServerUrl } from "@shared/client-contract"
import type { ServerProfile } from "@shared/bridge"
import { ConfigStore } from "@main/config-store"

type PublicInfo = { data?: { app_name?: string; organization_name?: string }; success?: boolean }

export class ServerProfiles {
  constructor(private readonly store: ConfigStore) {}

  list(): ServerProfile[] {
    return this.store.listServers()
  }

  require(id: string): ServerProfile {
    const profile = this.store.server(id)
    if (!profile) throw new Error("目标服务器不存在")
    return profile
  }

  async add(rawUrl: string, displayName?: string): Promise<ServerProfile> {
    const normalizedUrl = normalizeServerUrl(rawUrl, isDevelopmentHttpAllowed(rawUrl))
    const response = await session.defaultSession.fetch(`${normalizedUrl}/api/client/info`, {
      headers: { Accept: "application/json" },
      method: "GET",
    })
    if (!response.ok) throw new Error(`服务器探测失败（HTTP ${response.status}）`)
    const info = (await response.json()) as PublicInfo
    if (info.success !== true || !info.data || typeof info.data.app_name !== "string") {
      throw new Error("目标不是兼容的 MagicChat Server")
    }
    return this.store.addServer({
      displayName: cleanName(displayName || info.data.organization_name || info.data.app_name),
      normalizedUrl,
    })
  }

  rename(id: string, displayName: string): Promise<ServerProfile> {
    this.require(id)
    return this.store.updateServer(id, { displayName: cleanName(displayName) })
  }

  recordUser(id: string, userId: string): Promise<ServerProfile> {
    this.require(id)
    return this.store.updateServer(id, { lastUserId: userId })
  }
}

function cleanName(value: string): string {
  const result = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120)
  if (!result) throw new Error("服务器名称不能为空")
  return result
}

function isDevelopmentHttpAllowed(rawUrl: string): boolean {
  if (app.isPackaged) return false
  try {
    const hostname = new URL(rawUrl).hostname
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  } catch {
    return false
  }
}
