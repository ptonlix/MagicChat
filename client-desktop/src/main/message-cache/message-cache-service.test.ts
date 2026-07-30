// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ServerProfiles } from "@main/server-profiles"
import {
  MessageCacheError,
  type MessageCacheStats,
  type MessageCacheSyncState,
} from "@shared/message-cache-contract"
import type { MessageCacheWorkerOperation } from "./message-cache-protocol"
import { MessageCacheService } from "./message-cache-service"

const target = {
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
  userId: "user-1",
}
const scope = { conversationId: "conversation-1", target }
const available: MessageCacheStats = {
  conversationCount: 0,
  messageCount: 0,
  payloadBytes: 0,
  status: "available",
}

describe("MessageCacheService 故障恢复", () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  it("可用性故障进入有上限退避，恢复前不重复访问 Worker", async () => {
    let now = 0
    const client = new FakeWorkerClient()
    const service = createService(client, () => now)
    await service.initialize()
    client.failure = new MessageCacheError("cache_disk_full")

    await expect(service.getStats(target)).rejects.toMatchObject({ code: "cache_disk_full" })
    expect(await service.status()).toMatchObject({ status: "degraded" })
    const requestsAfterFailure = client.requests.length

    await expect(service.getStats(target)).rejects.toMatchObject({ code: "cache_unavailable" })
    expect(client.requests).toHaveLength(requestsAfterFailure)

    now = 1_000
    client.failure = null
    await expect(service.getStats(target)).resolves.toMatchObject({ status: "available" })
    expect(client.recoveries).toBe(1)
    expect(client.requests.slice(-2)).toEqual(["health", "getStats"])
  })

  it("generation 竞争不会把整个缓存标记为 degraded", async () => {
    const client = new FakeWorkerClient()
    const service = createService(client, () => 0)
    await service.initialize()
    client.failure = new MessageCacheError("cache_generation_stale")

    await expect(service.getSyncState(scope)).rejects.toMatchObject({
      code: "cache_generation_stale",
    })
    expect(await service.status()).toMatchObject({ status: "available" })
  })

  it("Server 缓存清理故障后后台重试且不依赖已删除 Profile", async () => {
    vi.useFakeTimers()
    let now = 0
    let profileAvailable = true
    const client = new FakeWorkerClient()
    const profiles = {
      list() {
        return profileAvailable ? [target] : []
      },
      require(id: string) {
        if (!profileAvailable || id !== target.id) throw new Error("missing profile")
        return target
      },
    } as unknown as ServerProfiles
    const service = new MessageCacheService("/unused", "/unused-worker.js", profiles, {
      client,
      now: () => now,
    })
    await service.initialize()
    client.failure = new MessageCacheError("cache_disk_full")

    expect(() => service.clearServerBestEffort(target)).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    expect(await service.status()).toMatchObject({ status: "degraded" })
    expect(client.requests).toContain("clearServer")

    profileAvailable = false
    client.failure = null
    now = 1_000
    await vi.advanceTimersByTimeAsync(1_000)

    expect(client.recoveries).toBe(1)
    expect(client.requests.slice(-2)).toEqual(["health", "clearServer"])
    expect(await service.status()).toMatchObject({ status: "available" })
    await service.close()
  })

  it("升级安装回滚后重开 Worker 并重新执行初始化检查", async () => {
    const client = new FakeWorkerClient()
    const service = createService(client, () => 0)
    await service.initialize()
    await service.close()

    await service.reopen()

    expect(client.reopenings).toBe(1)
    expect(client.requests.slice(-2)).toEqual(["clearOrphanedServers", "health"])
    expect(await service.status()).toMatchObject({ status: "available" })
    await service.close()
  })
})

class FakeWorkerClient {
  closed = false
  failure: MessageCacheError | null = null
  reopenings = 0
  recoveries = 0
  requests: string[] = []

  async close() {
    this.closed = true
  }

  async reopen() {
    this.closed = false
    this.reopenings += 1
  }

  async recover() {
    this.recoveries += 1
  }

  async request<T>(operation: MessageCacheWorkerOperation): Promise<T> {
    if (this.closed) throw new MessageCacheError("cache_closed")
    this.requests.push(operation.kind)
    if (operation.kind !== "health" && this.failure) throw this.failure
    if (operation.kind === "health" || operation.kind === "getStats") return available as T
    if (operation.kind === "getSyncState") return syncState() as T
    return undefined as T
  }
}

function createService(client: FakeWorkerClient, now: () => number) {
  const profiles = {
    list() {
      return [target]
    },
    require(id: string) {
      if (id !== target.id) throw new Error("missing profile")
      return target
    },
  } as unknown as ServerProfiles
  return new MessageCacheService("/unused", "/unused-worker.js", profiles, { client, now })
}

function syncState(): MessageCacheSyncState {
  return {
    conversationId: scope.conversationId,
    generation: { conversation: 0, server: 0, user: 0 },
    hasMoreBefore: true,
    httpSyncedThroughSeq: 0,
    lastAccessedAt: 0,
  }
}
