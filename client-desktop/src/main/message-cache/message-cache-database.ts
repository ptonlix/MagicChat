import { chmodSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { isolateDatabaseFiles, removeIsolatedDatabaseFiles } from "./message-cache-isolation"
import { MessageCacheStore } from "./message-cache-store"

export function openMessageCacheStore(databasePath: string): MessageCacheStore {
  const directory = path.dirname(databasePath)
  mkdirSync(directory, { mode: 0o700, recursive: true })
  if (process.platform !== "win32") chmodSync(directory, 0o700)
  removeIsolatedDatabaseFiles(databasePath)

  let store: MessageCacheStore
  try {
    store = new MessageCacheStore(databasePath)
  } catch {
    isolateDatabaseFiles(databasePath)
    store = new MessageCacheStore(databasePath)
  }
  try {
    secureDatabaseFiles(databasePath)
    removeIsolatedDatabaseFiles(databasePath)
    return store
  } catch (error) {
    try {
      store.close()
    } catch {
      // 清理失败时保留原始错误，由 Worker 进入稳定降级流程。
    }
    throw error
  }
}

function secureDatabaseFiles(databasePath: string): void {
  if (process.platform === "win32") return
  for (const extension of ["", "-wal", "-shm"]) {
    const filePath = `${databasePath}${extension}`
    if (existsSync(filePath)) chmodSync(filePath, 0o600)
  }
}
