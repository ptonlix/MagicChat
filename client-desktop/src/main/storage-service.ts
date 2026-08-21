import { lstat, readdir, rm, statfs } from "node:fs/promises"
import path from "node:path"

import type { SessionController } from "@main/session-controller"
import type { UpdateCacheLifecycle } from "@main/update-cache-lifecycle"
import type { UpdaterService } from "@main/updater-service"
import {
  storageCacheKinds,
  type DesktopStorageStats,
  type StorageCacheItem,
  type StorageCacheKind,
  type StorageClearResult,
} from "@shared/storage-contract"

const networkCacheDirectoryNames = new Set(["Cache"])
const runtimeCacheDirectoryNames = new Set([
  "Code Cache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUCache",
  "Shared Dictionary",
])

type StorageServiceOptions = Readonly<{
  installationPath: string | undefined
  sessions: Pick<SessionController, "clearNetworkCaches" | "clearRuntimeCaches">
  updateCache: Pick<UpdateCacheLifecycle, "discardInstallIntent">
  updater: Pick<UpdaterService, "canDiscardDownloadedUpdate" | "discardDownloadedUpdate">
  updaterCachePath: string
  userDataPath: string
}>

export class StorageService {
  private readonly installationPath: StorageServiceOptions["installationPath"]
  private readonly sessions: StorageServiceOptions["sessions"]
  private readonly updateCache: StorageServiceOptions["updateCache"]
  private readonly updater: StorageServiceOptions["updater"]
  private readonly updaterCachePath: string
  private readonly userDataPath: string

  constructor(options: StorageServiceOptions) {
    this.installationPath = options.installationPath
    this.sessions = options.sessions
    this.updateCache = options.updateCache
    this.updater = options.updater
    this.updaterCachePath = options.updaterCachePath
    this.userDataPath = options.userDataPath
  }

  async getStats(): Promise<DesktopStorageStats> {
    const [categories, disk, installationBytes] = await Promise.all([
      this.readCategories(),
      diskUsage(this.userDataPath),
      this.installationPath ? pathSize(this.installationPath) : 0,
    ])
    const cacheItems: ReadonlyArray<StorageCacheItem> = storageCacheKinds.map((kind) => ({
      bytes: categories[kind],
      clearable: kind !== "updates" || this.updater.canDiscardDownloadedUpdate(),
      kind,
    }))
    const appBytes = installationBytes + categories.userData + categories.updates
    const otherBytes = Math.max(
      0,
      installationBytes +
        categories.userData -
        categories.network -
        categories.runtime -
        categories.message -
        categories.diagnostics,
    )

    return {
      appBytes,
      cacheItems,
      diagnosticsBytes: categories.diagnostics,
      disk,
      messageCacheBytes: categories.message,
      otherBytes,
      userDataBytes: categories.userData,
    }
  }

  async clearCache(rawKinds: unknown): Promise<StorageClearResult> {
    const kinds = parseStorageCacheKinds(rawKinds)
    const before = await this.getStats()
    const expectedBytes = before.cacheItems
      .filter((item) => kinds.has(item.kind))
      .reduce((total, item) => total + item.bytes, 0)

    if (kinds.has("network")) await this.sessions.clearNetworkCaches()
    if (kinds.has("runtime")) await this.sessions.clearRuntimeCaches()
    if (kinds.has("updates")) {
      if (!this.updater.canDiscardDownloadedUpdate()) {
        throw new Error("更新正在下载或安装，暂时无法清理已下载更新")
      }
      await rm(this.updaterCachePath, { force: true, recursive: true })
      this.updater.discardDownloadedUpdate()
      if (!(await this.updateCache.discardInstallIntent())) {
        throw new Error("无法清除更新安装意图")
      }
    }

    const stats = await this.getStats()
    return {
      expectedBytes,
      reclaimedBytes: Math.max(0, before.appBytes - stats.appBytes),
      stats,
    }
  }

  private async readCategories(): Promise<{
    diagnostics: number
    message: number
    network: number
    runtime: number
    updates: number
    userData: number
  }> {
    const [userData, updates] = await Promise.all([
      directorySize(this.userDataPath),
      directorySize(this.updaterCachePath),
    ])
    const categories = {
      diagnostics: await directorySize(path.join(this.userDataPath, "diagnostics")),
      message: await directorySize(path.join(this.userDataPath, "message-cache")),
      network: 0,
      runtime: 0,
      updates,
      userData,
    }

    const names = await directoryNames(this.userDataPath)
    for (const name of names) {
      const candidate = path.join(this.userDataPath, name)
      if (networkCacheDirectoryNames.has(name)) categories.network += await directorySize(candidate)
      else if (runtimeCacheDirectoryNames.has(name))
        categories.runtime += await directorySize(candidate)
      else if (name === "Partitions") {
        const partitions = await directoryNames(candidate)
        for (const partition of partitions) {
          const partitionPath = path.join(candidate, partition)
          for (const child of await directoryNames(partitionPath)) {
            const childPath = path.join(partitionPath, child)
            if (networkCacheDirectoryNames.has(child)) {
              categories.network += await directorySize(childPath)
            } else if (runtimeCacheDirectoryNames.has(child)) {
              categories.runtime += await directorySize(childPath)
            }
          }
        }
      }
    }

    return categories
  }
}

export function parseStorageCacheKinds(rawKinds: unknown): ReadonlySet<StorageCacheKind> {
  if (
    !Array.isArray(rawKinds) ||
    rawKinds.length === 0 ||
    rawKinds.length > storageCacheKinds.length
  )
    throw new Error("缓存清理项目无效")
  const kinds = new Set<StorageCacheKind>()
  for (const rawKind of rawKinds) {
    if (!storageCacheKinds.includes(rawKind as StorageCacheKind)) {
      throw new Error("缓存清理项目无效")
    }
    kinds.add(rawKind as StorageCacheKind)
  }
  if (kinds.size !== rawKinds.length) throw new Error("缓存清理项目无效")
  return kinds
}

async function directoryNames(directory: string): Promise<ReadonlyArray<string>> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

async function directorySize(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        const candidate = path.join(directory, entry.name)
        if (entry.isDirectory()) return directorySize(candidate)
        if (!entry.isFile()) return 0
        try {
          const file = await lstat(candidate)
          return file.size
        } catch {
          return 0
        }
      }),
    )
    return sizes.reduce((total, size) => total + size, 0)
  } catch {
    return 0
  }
}

async function pathSize(target: string): Promise<number> {
  try {
    const entry = await lstat(target)
    if (entry.isFile()) return entry.size
    return entry.isDirectory() ? directorySize(target) : 0
  } catch {
    return 0
  }
}

async function diskUsage(directory: string): Promise<DesktopStorageStats["disk"]> {
  try {
    const result = await statfs(directory)
    const totalBytes = safeProduct(result.blocks, result.bsize)
    const availableBytes = Math.min(totalBytes, safeProduct(result.bavail, result.bsize))
    return {
      availableBytes,
      totalBytes,
      usedBytes: Math.max(0, totalBytes - availableBytes),
    }
  } catch {
    return { availableBytes: 0, totalBytes: 0, usedBytes: 0 }
  }
}

function safeProduct(left: number, right: number): number {
  const result = left * right
  return Number.isSafeInteger(result) && result >= 0 ? result : 0
}
