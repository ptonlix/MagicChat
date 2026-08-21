import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SessionController } from "@main/session-controller"
import { StorageService, parseStorageCacheKinds } from "@main/storage-service"
import type { UpdateCacheLifecycle } from "@main/update-cache-lifecycle"
import type { UpdaterService } from "@main/updater-service"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe("StorageService", () => {
  it("按互不重叠的类别统计缓存、消息、诊断与其他必要数据", async () => {
    const paths = await createPaths()
    await writeBytes(path.join(paths.userData, "Cache", "network.bin"), 100)
    await writeBytes(path.join(paths.userData, "Code Cache", "runtime.bin"), 200)
    await writeBytes(
      path.join(paths.userData, "Partitions", "magicchat-server-a", "Cache", "image.bin"),
      300,
    )
    await writeBytes(
      path.join(paths.userData, "Partitions", "magicchat-server-a", "GPUCache", "gpu.bin"),
      400,
    )
    await writeBytes(path.join(paths.userData, "message-cache", "messages.sqlite"), 500)
    await writeBytes(path.join(paths.userData, "diagnostics", "realtime.jsonl"), 600)
    await writeBytes(path.join(paths.userData, "Local State"), 700)
    await writeBytes(path.join(paths.updaterCache, "update.zip"), 800)
    await writeBytes(path.join(paths.installation, "MagicChat"), 900)

    const stats = await createService(paths).getStats()

    expect(stats.cacheItems).toEqual([
      { bytes: 400, clearable: true, kind: "network" },
      { bytes: 600, clearable: true, kind: "runtime" },
      { bytes: 800, clearable: true, kind: "updates" },
    ])
    expect(stats.messageCacheBytes).toBe(500)
    expect(stats.diagnosticsBytes).toBe(600)
    expect(stats.otherBytes).toBe(1_600)
    expect(stats.appBytes).toBe(4_500)
    expect(stats.userDataBytes).toBe(2_800)
    expect(stats.disk.totalBytes).toBeGreaterThan(0)
    expect(stats.disk.usedBytes + stats.disk.availableBytes).toBe(stats.disk.totalBytes)
  })

  it("仅调用已勾选的网络和运行缓存清理器", async () => {
    const paths = await createPaths()
    await writeBytes(path.join(paths.userData, "Cache", "network.bin"), 100)
    await writeBytes(path.join(paths.userData, "GPUCache", "runtime.bin"), 200)
    const sessions: Pick<SessionController, "clearNetworkCaches" | "clearRuntimeCaches"> = {
      clearNetworkCaches: vi.fn().mockResolvedValue(undefined),
      clearRuntimeCaches: vi.fn().mockResolvedValue(undefined),
    }
    const service = createService(paths, { sessions })

    const result = await service.clearCache(["network", "runtime"])

    expect(sessions.clearNetworkCaches).toHaveBeenCalledOnce()
    expect(sessions.clearRuntimeCaches).toHaveBeenCalledOnce()
    expect(result.expectedBytes).toBe(300)
  })

  it("清理已下载更新后移除更新包并回退更新状态", async () => {
    const paths = await createPaths()
    await writeBytes(path.join(paths.updaterCache, "update.zip"), 1024)
    const updater: Pick<UpdaterService, "canDiscardDownloadedUpdate" | "discardDownloadedUpdate"> =
      {
        canDiscardDownloadedUpdate: vi.fn(() => true),
        discardDownloadedUpdate: vi.fn(),
      }
    const updateCache: Pick<UpdateCacheLifecycle, "discardInstallIntent"> = {
      discardInstallIntent: vi.fn().mockResolvedValue(true),
    }
    const service = createService(paths, { updateCache, updater })

    const result = await service.clearCache(["updates"])

    expect(result.expectedBytes).toBe(1024)
    expect(result.reclaimedBytes).toBe(1024)
    expect(result.stats.cacheItems.find((item) => item.kind === "updates")?.bytes).toBe(0)
    expect(updateCache.discardInstallIntent).toHaveBeenCalledOnce()
    expect(updater.discardDownloadedUpdate).toHaveBeenCalledOnce()
  })

  it("安装意图删除失败时保留待重试状态", async () => {
    const paths = await createPaths()
    await writeBytes(path.join(paths.updaterCache, "update.zip"), 1024)
    const updater: Pick<UpdaterService, "canDiscardDownloadedUpdate" | "discardDownloadedUpdate"> =
      {
        canDiscardDownloadedUpdate: vi.fn(() => true),
        discardDownloadedUpdate: vi.fn(),
      }
    const updateCache: Pick<UpdateCacheLifecycle, "discardInstallIntent"> = {
      discardInstallIntent: vi.fn().mockResolvedValue(false),
    }
    const service = createService(paths, { updateCache, updater })

    await expect(service.clearCache(["updates"])).rejects.toThrow("无法清除更新安装意图")
    await expect(readFile(path.join(paths.updaterCache, "update.zip"))).rejects.toThrow()
    expect(updater.discardDownloadedUpdate).toHaveBeenCalledOnce()
  })

  it("拒绝空、重复或未知的缓存清理项目", () => {
    expect(() => parseStorageCacheKinds([])).toThrow("缓存清理项目无效")
    expect(() => parseStorageCacheKinds(["network", "network"])).toThrow("缓存清理项目无效")
    expect(() => parseStorageCacheKinds(["credentials"])).toThrow("缓存清理项目无效")
  })

  it("更新下载或安装期间拒绝清理更新缓存", async () => {
    const paths = await createPaths()
    await writeBytes(path.join(paths.updaterCache, "update.zip"), 1024)
    const updater: Pick<UpdaterService, "canDiscardDownloadedUpdate" | "discardDownloadedUpdate"> =
      {
        canDiscardDownloadedUpdate: vi.fn(() => false),
        discardDownloadedUpdate: vi.fn(),
      }
    const service = createService(paths, { updater })

    await expect(service.clearCache(["updates"])).rejects.toThrow("更新正在下载或安装")
    expect(updater.discardDownloadedUpdate).not.toHaveBeenCalled()
  })
})

async function createPaths(): Promise<{
  installation: string
  updaterCache: string
  userData: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), "magicchat-storage-"))
  temporaryDirectories.push(root)
  return {
    installation: path.join(root, "installation"),
    updaterCache: path.join(root, "updater"),
    userData: path.join(root, "user-data"),
  }
}

function createService(
  paths: { installation: string; updaterCache: string; userData: string },
  overrides: Partial<{
    sessions: Pick<SessionController, "clearNetworkCaches" | "clearRuntimeCaches">
    updateCache: Pick<UpdateCacheLifecycle, "discardInstallIntent">
    updater: Pick<UpdaterService, "canDiscardDownloadedUpdate" | "discardDownloadedUpdate">
  }> = {},
): StorageService {
  return new StorageService({
    installationPath: paths.installation,
    sessions: overrides.sessions ?? {
      clearNetworkCaches: vi.fn().mockResolvedValue(undefined),
      clearRuntimeCaches: vi.fn().mockResolvedValue(undefined),
    },
    updateCache: overrides.updateCache ?? {
      discardInstallIntent: vi.fn().mockResolvedValue(true),
    },
    updater: overrides.updater ?? {
      canDiscardDownloadedUpdate: vi.fn(() => true),
      discardDownloadedUpdate: vi.fn(),
    },
    updaterCachePath: paths.updaterCache,
    userDataPath: paths.userData,
  })
}

async function writeBytes(filePath: string, size: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, Buffer.alloc(size))
}
