import type { ServerProfile } from "@shared/bridge"

export type ServerRemovalDependencies = {
  credentials: { removeServer(id: string): Promise<void> }
  files: { cleanupServer(id: string): Promise<void> }
  messageCache: { clearServerBestEffort(profile: ServerProfile): void }
  realtime: { closeServer(id: string): void }
  sessions: { remove(profile: ServerProfile): Promise<void> }
  store: { removeServer(id: string): Promise<void> }
  uploads: { cleanupServer(id: string): void }
}

export async function removeServerResources(
  deps: ServerRemovalDependencies,
  id: string,
  profile: ServerProfile,
): Promise<void> {
  deps.realtime.closeServer(id)
  deps.uploads.cleanupServer(id)
  try {
    deps.messageCache.clearServerBestEffort(profile)
  } catch {
    // 缓存是可降级能力，不能阻止凭据、Session 和 Profile 的安全清理。
  }
  await Promise.all([
    deps.files.cleanupServer(id),
    deps.sessions.remove(profile),
    deps.credentials.removeServer(id),
  ])
  await deps.store.removeServer(id)
}
