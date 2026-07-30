import { existsSync, readdirSync, renameSync, unlinkSync } from "node:fs"
import path from "node:path"

const databaseExtensions = ["", "-wal", "-shm"] as const

export function isolateDatabaseFiles(databasePath: string): void {
  const suffix = `.isolated-${Date.now()}`
  for (const extension of databaseExtensions) {
    const source = `${databasePath}${extension}`
    if (existsSync(source)) renameSync(source, `${source}${suffix}`)
  }
}

export function removeIsolatedDatabaseFiles(databasePath: string): void {
  const directory = path.dirname(databasePath)
  if (!existsSync(directory)) return
  const basename = escapeRegExp(path.basename(databasePath))
  const isolatedName = new RegExp(`^${basename}(?:-wal|-shm)?\\.isolated-\\d+$`)
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!isolatedName.test(entry.name)) continue
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    unlinkSync(path.join(directory, entry.name))
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
