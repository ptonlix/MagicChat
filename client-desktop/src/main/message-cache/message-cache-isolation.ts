import { existsSync, readdirSync, renameSync, unlinkSync } from "node:fs"
import path from "node:path"

const databaseExtensions = ["-wal", "-shm", ""] as const

export function isolateDatabaseFiles(
  databasePath: string,
  renameFile: (source: string, target: string) => void = renameSync,
): void {
  const suffix = `.isolated-${Date.now()}`
  const moved: Array<Readonly<{ source: string; target: string }>> = []
  try {
    for (const extension of databaseExtensions) {
      const source = `${databasePath}${extension}`
      if (!existsSync(source)) continue
      const target = `${source}${suffix}`
      renameFile(source, target)
      moved.push({ source, target })
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const { source, target } of moved.reverse()) {
      try {
        renameFile(target, source)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "数据库隔离回滚失败")
    }
    throw error
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
