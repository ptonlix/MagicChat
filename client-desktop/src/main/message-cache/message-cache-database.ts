import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs"
import path from "node:path"
import { MessageCacheStore } from "./message-cache-store"

export function openMessageCacheStore(databasePath: string): MessageCacheStore {
  const directory = path.dirname(databasePath)
  mkdirSync(directory, { mode: 0o700, recursive: true })
  if (process.platform !== "win32") chmodSync(directory, 0o700)

  try {
    const store = new MessageCacheStore(databasePath)
    secureDatabaseFiles(databasePath)
    return store
  } catch {
    isolateDatabase(databasePath)
    const store = new MessageCacheStore(databasePath)
    secureDatabaseFiles(databasePath)
    return store
  }
}

function isolateDatabase(databasePath: string): void {
  const suffix = `.isolated-${Date.now()}`
  for (const extension of ["", "-wal", "-shm"]) {
    const source = `${databasePath}${extension}`
    if (existsSync(source)) renameSync(source, `${source}${suffix}`)
  }
}

function secureDatabaseFiles(databasePath: string): void {
  if (process.platform === "win32") return
  for (const extension of ["", "-wal", "-shm"]) {
    const filePath = `${databasePath}${extension}`
    if (existsSync(filePath)) chmodSync(filePath, 0o600)
  }
}
