import { createReadStream, createWriteStream } from "node:fs"
import { open, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { dialog, shell } from "electron"
import { assertClientPath, type AuthenticatedTarget, type ClientResponse } from "@shared/client-contract"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"

type PickedFile = { name: string; ownerId: number; path: string; size: number }

export class FileService {
  private readonly picked = new Map<string, PickedFile>()
  private readonly activeUploads = new Map<string, { controller: AbortController; serverId: string }>()
  private readonly temporary = new Map<string, { controller: AbortController; serverId: string }>()

  constructor(private readonly profiles: ServerProfiles, private readonly sessions: SessionController) {}

  async pick(ownerId: number, multiple = false): Promise<Array<{ id: string; name: string; size: number }>> {
    const result = await dialog.showOpenDialog({ properties: multiple ? ["openFile", "multiSelections"] : ["openFile"] })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(async (filePath) => {
      const info = await stat(filePath)
      const id = randomUUID()
      this.picked.set(id, { name: path.basename(filePath), ownerId, path: filePath, size: info.size })
      return { id, name: path.basename(filePath), size: info.size }
    }))
  }

  async upload(ownerId: number, target: AuthenticatedTarget, apiPath: string, fileId: string): Promise<ClientResponse> {
    const picked = this.picked.get(fileId)
    if (!picked || picked.ownerId !== ownerId) throw new Error("文件句柄无效")
    const profile = this.profiles.require(target.id)
    if (profile.normalizedUrl !== target.normalizedUrl) throw new Error("认证目标无效")
    const boundary = `magicchat-${randomUUID()}`
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename(picked.name)}"\r\nContent-Type: application/octet-stream\r\n\r\n`)
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Readable.from((async function* () { yield prefix; yield* createReadStream(picked.path); yield suffix })())
    const controller = new AbortController()
    this.activeUploads.set(fileId, { controller, serverId: profile.id })
    try {
      const response = await this.sessions.for(profile).fetch(`${profile.normalizedUrl}${assertClientPath(apiPath)}`, {
        body: Readable.toWeb(body) as ReadableStream,
        credentials: "include",
        duplex: "half",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        method: "POST",
        signal: controller.signal,
      } as RequestInit)
      return { body: await response.json(), headers: { "content-type": response.headers.get("content-type") ?? "" }, status: response.status }
    } finally {
      this.activeUploads.delete(fileId)
      this.picked.delete(fileId)
    }
  }

  async download(target: AuthenticatedTarget, apiPath: string, suggestedName: string): Promise<{ path?: string }> {
    const profile = this.profiles.require(target.id)
    if (profile.normalizedUrl !== target.normalizedUrl) throw new Error("认证目标无效")
    const result = await dialog.showSaveDialog({ defaultPath: safeFilename(suggestedName) })
    if (result.canceled || !result.filePath) return {}
    const temporaryPath = `${result.filePath}.magicchat-${randomUUID()}.part`
    const controller = new AbortController()
    this.temporary.set(temporaryPath, { controller, serverId: profile.id })
    try {
      const response = await this.sessions.for(profile).fetch(`${profile.normalizedUrl}${assertClientPath(apiPath)}`, { credentials: "include", signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）`)
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(temporaryPath, { flags: "wx" }))
      await rename(temporaryPath, result.filePath)
      return { path: result.filePath }
    } finally {
      this.temporary.delete(temporaryPath)
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  async openLocation(filePath: string): Promise<void> {
    if (!path.isAbsolute(filePath)) throw new Error("文件路径无效")
    await open(filePath, "r").then((handle) => handle.close())
    shell.showItemInFolder(filePath)
  }

  releaseOwner(ownerId: number): void {
    for (const [id, value] of this.picked) if (value.ownerId === ownerId) this.picked.delete(id)
  }

  async cleanupServer(serverId: string): Promise<void> {
    for (const [fileId, upload] of this.activeUploads) {
      if (upload.serverId !== serverId) continue
      upload.controller.abort()
      this.activeUploads.delete(fileId)
      this.picked.delete(fileId)
    }
    const paths: string[] = []
    for (const [filePath, download] of this.temporary) {
      if (download.serverId !== serverId) continue
      download.controller.abort()
      this.temporary.delete(filePath)
      paths.push(filePath)
    }
    await Promise.all(paths.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)))
  }

  async cleanup(): Promise<void> {
    for (const upload of this.activeUploads.values()) upload.controller.abort()
    for (const download of this.temporary.values()) download.controller.abort()
    await Promise.all([...this.temporary.keys()].map((filePath) => rm(filePath, { force: true }).catch(() => undefined)))
    this.activeUploads.clear()
    this.temporary.clear()
  }

  hasActiveTransfers(): boolean { return this.activeUploads.size > 0 || this.temporary.size > 0 }
}

export function safeFilename(value: string): string {
  const basename = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 180)
  return basename && basename !== "." && basename !== ".." ? basename : "download"
}
