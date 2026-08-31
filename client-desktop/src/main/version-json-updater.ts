import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"
import {
  compareStableVersions,
  DESKTOP_VERSION_MANIFEST_URL,
  selectDesktopVersionEntry,
  type DesktopVersionEntry,
} from "@main/desktop-version-manifest"

export type VersionJsonUpdaterEvent =
  | "checking-for-update"
  | "download-progress"
  | "error"
  | "update-available"
  | "update-downloaded"
  | "update-not-available"

export type VersionJsonUpdateInfo = DesktopVersionEntry

type FetchResponse = Pick<Response, "body" | "headers" | "json" | "ok" | "status" | "url">

type VersionJsonUpdaterOptions = Readonly<{
  arch: string
  cacheDirectory: string
  currentVersion: string
  fetcher: (url: string, init: RequestInit) => Promise<FetchResponse>
  installPackage: (filePath: string, entry: DesktopVersionEntry) => Promise<void>
  manifestUrl?: string
  platform: NodeJS.Platform
}>

export class VersionJsonUpdater {
  private available?: DesktopVersionEntry
  private downloadAbort?: AbortController
  private downloadedPath?: string
  private readonly listeners = new Map<VersionJsonUpdaterEvent, Set<(payload?: unknown) => void>>()

  constructor(private readonly options: VersionJsonUpdaterOptions) {}

  async checkForUpdates(): Promise<void> {
    this.emit("checking-for-update")
    const manifestUrl = this.options.manifestUrl ?? DESKTOP_VERSION_MANIFEST_URL
    const response = await this.fetchWithTimeout(cacheBustedUrl(manifestUrl), 15_000)
    if (!response.ok) throw httpError(response.status, "metadata")
    const entry = selectDesktopVersionEntry(
      await response.json(),
      this.options.platform,
      this.options.arch,
    )
    if (!entry) throw new Error("platform architecture mismatch")
    if (compareStableVersions(entry.version, this.options.currentVersion) <= 0) {
      this.available = undefined
      this.emit("update-not-available", { version: this.options.currentVersion })
      return
    }
    this.available = entry
    this.emit("update-available", entry)
  }

  async downloadUpdate(): Promise<void> {
    const entry = this.available
    if (!entry) throw new Error("metadata missing available update")
    await mkdir(this.options.cacheDirectory, { recursive: true })
    const extension = packageExtension(entry.url)
    const finalPath = path.join(
      this.options.cacheDirectory,
      `MagicChat-${entry.version}${extension}`,
    )
    const temporaryPath = `${finalPath}.${randomUUID()}.part`
    const abort = new AbortController()
    this.downloadAbort = abort
    try {
      const response = await this.fetchWithTimeout(entry.url, 30 * 60_000, abort.signal)
      if (!response.ok) throw httpError(response.status, "package")
      if (!response.body) throw new Error("network response body missing")
      const declaredLength = contentLength(response.headers.get("content-length"))
      if (
        entry.size !== undefined &&
        declaredLength !== undefined &&
        declaredLength !== entry.size
      ) {
        throw new Error("checksum size mismatch")
      }
      const handle = await open(temporaryPath, "wx", 0o600)
      const digest = createHash("sha512")
      let received = 0
      try {
        const reader = response.body.getReader()
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (chunk.value.byteLength === 0) continue
          await handle.write(chunk.value)
          digest.update(chunk.value)
          received += chunk.value.byteLength
          const total = entry.size ?? declaredLength
          if (total && total > 0) {
            this.emit("download-progress", { percent: Math.min(99, (received / total) * 100) })
          }
        }
      } finally {
        await handle.close()
      }
      if (received <= 0) throw new Error("checksum empty package")
      if (entry.size !== undefined && received !== entry.size) {
        throw new Error("checksum size mismatch")
      }
      if (declaredLength !== undefined && received !== declaredLength) {
        throw new Error("network incomplete package")
      }
      if (entry.sha512 !== undefined && digest.digest("base64") !== entry.sha512) {
        throw new Error("checksum sha512 mismatch")
      }
      await validatePackageHeader(temporaryPath, this.options.platform, this.options.arch)
      await rm(finalPath, { force: true })
      await rename(temporaryPath, finalPath)
      if (this.options.platform === "linux") await chmod(finalPath, 0o700)
      this.downloadedPath = finalPath
      this.emit("update-downloaded", entry)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      if (this.downloadAbort === abort) this.downloadAbort = undefined
    }
  }

  async installUpdate(): Promise<void> {
    if (!this.available || !this.downloadedPath) throw new Error("update package not downloaded")
    await this.options.installPackage(this.downloadedPath, this.available)
  }

  cancelDownload(): void {
    this.downloadAbort?.abort(new Error("network download canceled"))
  }

  async discardDownloadedUpdate(): Promise<void> {
    const downloadedPath = this.downloadedPath
    this.downloadedPath = undefined
    if (downloadedPath) await rm(downloadedPath, { force: true }).catch(() => undefined)
  }

  on(event: VersionJsonUpdaterEvent, listener: (payload?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event: VersionJsonUpdaterEvent, listener: (payload?: unknown) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  private emit(event: VersionJsonUpdaterEvent, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number,
    parentSignal?: AbortSignal,
  ): Promise<FetchResponse> {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new Error("network request timed out")), timeoutMs)
    timer.unref?.()
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout.signal]) : timeout.signal
    try {
      return await this.options.fetcher(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json, application/octet-stream",
          "Cache-Control": "no-cache",
        },
        redirect: "follow",
        signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

async function validatePackageHeader(
  filePath: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<void> {
  const handle = await open(filePath, "r")
  try {
    const fileStat = await handle.stat()
    if (platform === "darwin") {
      if (fileStat.size < 512) throw new Error("platform invalid macOS DMG")
      const trailer = Buffer.alloc(512)
      await handle.read(trailer, 0, trailer.length, fileStat.size - trailer.length)
      if (!trailer.includes(Buffer.from("koly"))) throw new Error("platform invalid macOS DMG")
      return
    }
    const header = Buffer.alloc(64)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (platform === "win32") {
      if (bytesRead < 2 || header[0] !== 0x4d || header[1] !== 0x5a) {
        throw new Error("platform invalid Windows installer")
      }
      return
    }
    if (
      bytesRead < 20 ||
      header[0] !== 0x7f ||
      header[1] !== 0x45 ||
      header[2] !== 0x4c ||
      header[3] !== 0x46
    ) {
      throw new Error("platform invalid Linux AppImage")
    }
    const littleEndian = header[5] === 1
    const machine = littleEndian ? header.readUInt16LE(18) : header.readUInt16BE(18)
    const expectedMachine = arch === "arm64" ? 183 : 62
    if (machine !== expectedMachine) throw new Error("platform architecture mismatch")
  } finally {
    await handle.close()
  }
}

function cacheBustedUrl(value: string): string {
  const url = new URL(value)
  url.searchParams.set("_", Date.now().toString())
  return url.toString()
}

function contentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined
}

function httpError(status: number, kind: string): Error {
  return new Error(status === 429 ? `status code 429 ${kind}` : `network HTTP ${status} ${kind}`)
}

function packageExtension(value: string): string {
  const pathname = new URL(value).pathname.toLowerCase()
  if (pathname.endsWith(".exe")) return ".exe"
  if (pathname.endsWith(".dmg")) return ".dmg"
  if (pathname.endsWith(".appimage")) return ".AppImage"
  throw new Error("platform package extension mismatch")
}
