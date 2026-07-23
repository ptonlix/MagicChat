import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { safeStorage } from "electron"

export class CredentialStore {
  constructor(private readonly directory: string) {}

  available(): boolean {
    return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== "basic_text"
  }

  async set(serverId: string, accountId: string, secret: string): Promise<void> {
    if (!this.available()) throw new Error("当前系统安全存储不可用")
    await mkdir(this.directory, { recursive: true })
    await writeFile(this.entry(serverId, accountId), safeStorage.encryptString(secret), { mode: 0o600 })
  }

  async get(serverId: string, accountId: string): Promise<string | undefined> {
    if (!this.available()) return undefined
    try { return safeStorage.decryptString(await readFile(this.entry(serverId, accountId))) } catch { return undefined }
  }

  async removeServer(serverId: string): Promise<void> {
    const prefix = `${safeSegment(serverId)}-`
    const { readdir } = await import("node:fs/promises")
    for (const name of await readdir(this.directory).catch(() => [])) if (name.startsWith(prefix)) await rm(path.join(this.directory, name), { force: true })
  }

  private entry(serverId: string, accountId: string): string {
    return path.join(this.directory, `${safeSegment(serverId)}-${safeSegment(accountId)}.bin`)
  }
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw new Error("安全存储标识无效")
  return value
}
