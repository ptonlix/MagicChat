import type { ServerProfile } from "@shared/bridge"

export type ServerRemovalDependencies = {
  asr: { closeServer(id: string): void }
  documentCollaboration: { closeServer(id: string): void }
  documentWindows?: {
    deleteServerState(id: string): Promise<void>
    requestCloseServer(id: string): Promise<boolean>
  }
  credentials: { removeServer(id: string): Promise<void> }
  files: { cleanupServer(id: string): Promise<void> }
  http: { cancelServer(id: string): void }
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
): Promise<boolean> {
  if (deps.documentWindows && !(await deps.documentWindows.requestCloseServer(id))) return false

  deps.http.cancelServer(id)
  deps.asr.closeServer(id)
  deps.documentCollaboration.closeServer(id)
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
    deps.documentWindows?.deleteServerState(id) ?? Promise.resolve(),
  ])
  await deps.store.removeServer(id)
  return true
}
