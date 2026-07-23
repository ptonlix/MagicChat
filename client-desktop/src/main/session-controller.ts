import { session, type Session } from "electron"
import type { ServerProfile } from "../shared/bridge"

export class SessionController {
  private readonly sessions = new Map<string, Session>()

  for(profile: ServerProfile): Session {
    const existing = this.sessions.get(profile.id)
    if (existing) return existing
    const partition = `persist:magicchat-server-${profile.id.replace(/[^a-zA-Z0-9-]/g, "")}`
    const value = session.fromPartition(partition, { cache: true })
    value.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    value.setPermissionCheckHandler(() => false)
    value.setCertificateVerifyProc((_request, callback) => callback(-3))
    this.sessions.set(profile.id, value)
    return value
  }

  async remove(profile: ServerProfile): Promise<void> {
    const value = this.for(profile)
    await Promise.all([value.clearStorageData(), value.clearCache()])
    value.flushStorageData()
    this.sessions.delete(profile.id)
  }
}
