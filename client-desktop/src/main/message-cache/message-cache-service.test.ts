// @vitest-environment node
import { describe, expect, it } from "vitest"
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
})

class FakeWorkerClient {
  failure: MessageCacheError | null = null
  recoveries = 0
  requests: string[] = []

  async close() {}

  async recover() {
    this.recoveries += 1
  }

  async request<T>(operation: MessageCacheWorkerOperation): Promise<T> {
    this.requests.push(operation.kind)
    if (operation.kind !== "health" && this.failure) throw this.failure
    if (operation.kind === "health" || operation.kind === "getStats") return available as T
    if (operation.kind === "getSyncState") return syncState() as T
    return undefined as T
  }
}

function createService(client: FakeWorkerClient, now: () => number) {
  const profiles = {
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
