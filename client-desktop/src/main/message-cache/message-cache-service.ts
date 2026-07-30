import path from "node:path"
import type { ServerProfiles } from "@main/server-profiles"
import { MessageCacheError, type MessageCacheStats } from "@shared/message-cache-contract"
import type { MessageCacheWorkerOperation } from "./message-cache-protocol"
import { MessageCacheWorkerClient } from "./message-cache-worker-client"
import {
  parseMessageCacheCommit,
  parseMessageCacheGeneration,
  parseMessageCacheId,
  parseMessageCacheLimit,
  parseMessageCacheRecords,
  parseMessageCacheScope,
  parseMessageCacheSeq,
  parseMessageCacheServerTarget,
  parseMessageCacheTarget,
} from "./message-cache-validation"

export class MessageCacheService {
  private readonly client: MessageCacheWorkerPort
  private readonly now: () => number
  private readonly pendingServerClears = new Map<
    string,
    Readonly<{ id: string; normalizedUrl: string }>
  >()
  private closed = false
  private nextRecoveryAt = 0
  private recoveryAttempts = 0
  private serverClearRetry: ReturnType<typeof setTimeout> | undefined
  private serverClearRun: Promise<void> | undefined
  private statusValue: MessageCacheStats = {
    conversationCount: 0,
    messageCount: 0,
    payloadBytes: 0,
    status: "rebuilding",
  }

  constructor(
    userDataPath: string,
    workerPath: string,
    private readonly profiles: ServerProfiles,
    options: Readonly<{
      client?: MessageCacheWorkerPort
      now?: () => number
    }> = {},
  ) {
    this.client =
      options.client ??
      new MessageCacheWorkerClient(
        workerPath,
        path.join(userDataPath, "message-cache", "messages-v1.sqlite3"),
      )
    this.now = options.now ?? Date.now
  }

  async initialize(): Promise<void> {
    await this.run(async () => {
      await this.client.request({
        kind: "clearOrphanedServers",
        targets: this.profiles.list().map(({ id, normalizedUrl }) => ({ id, normalizedUrl })),
      })
      this.statusValue = await this.client.request({ kind: "health" })
    })
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.serverClearRetry !== undefined) clearTimeout(this.serverClearRetry)
    await this.serverClearRun?.catch(() => undefined)
    await this.client.close()
  }

  async reopen(): Promise<void> {
    if (!this.closed) return
    await this.client.reopen()
    this.closed = false
    this.statusValue = { ...this.statusValue, status: "rebuilding" }
    await this.initialize()
    this.startPendingServerClears()
  }

  clearAll(): Promise<void> {
    return this.run(() => this.client.request({ kind: "clearAll" }))
  }

  clearConversation(rawScope: unknown) {
    const scope = this.scope(rawScope)
    return this.run(() => this.client.request({ kind: "clearConversation", scope }))
  }

  clearServer(rawTarget: unknown): Promise<void> {
    const target = parseMessageCacheServerTarget(rawTarget)
    this.requireProfile(target)
    return this.run(() => this.client.request({ kind: "clearServer", target }))
  }

  clearServerBestEffort(rawTarget: unknown): void {
    try {
      const target = parseMessageCacheServerTarget(rawTarget)
      this.requireProfile(target)
      this.pendingServerClears.set(serverClearKey(target), target)
      this.startPendingServerClears()
    } catch {
      // Server 移除是安全强制路径，缓存校验或调度失败不得阻止它。
    }
  }

  clearUser(rawTarget: unknown): Promise<void> {
    const target = this.target(rawTarget)
    return this.run(() => this.client.request({ kind: "clearUser", target }))
  }

  commitAfter(rawScope: unknown, rawCommit: unknown) {
    const scope = this.scope(rawScope)
    const commit = parseMessageCacheCommit(rawCommit, scope)
    if (commit.requestAfterSeq === undefined) invalidCommit()
    return this.run(() => this.client.request({ commit, kind: "commitAfter", scope }))
  }

  commitBefore(rawScope: unknown, rawCommit: unknown) {
    const scope = this.scope(rawScope)
    const commit = parseMessageCacheCommit(rawCommit, scope)
    if (commit.requestBeforeSeq === undefined) invalidCommit()
    return this.run(() => this.client.request({ commit, kind: "commitBefore", scope }))
  }

  commitLatest(rawScope: unknown, rawCommit: unknown) {
    const scope = this.scope(rawScope)
    const commit = parseMessageCacheCommit(rawCommit, scope)
    return this.run(() => this.client.request({ commit, kind: "commitLatest", scope }))
  }

  getById(rawScope: unknown, rawMessageId: unknown) {
    const scope = this.scope(rawScope)
    const messageId = parseMessageCacheId(rawMessageId)
    return this.run(() => this.client.request({ kind: "getById", messageId, scope }))
  }

  getStats(rawTarget?: unknown): Promise<MessageCacheStats> {
    const target = rawTarget === undefined ? undefined : this.target(rawTarget)
    return this.run(async () => {
      const stats = await this.client.request<MessageCacheStats>({ kind: "getStats", target })
      this.statusValue = stats
      return stats
    })
  }

  getSyncState(rawScope: unknown) {
    const scope = this.scope(rawScope)
    return this.run(() => this.client.request({ kind: "getSyncState", scope }))
  }

  listSyncStates(rawTarget: unknown) {
    const target = this.target(rawTarget)
    return this.run(() => this.client.request({ kind: "listSyncStates", target }))
  }

  readBefore(rawScope: unknown, rawBeforeSeq: unknown, rawLimit: unknown) {
    const scope = this.scope(rawScope)
    const beforeSeq = parseMessageCacheSeq(rawBeforeSeq)
    const limit = parseMessageCacheLimit(rawLimit)
    return this.run(() => this.client.request({ beforeSeq, kind: "readBefore", limit, scope }))
  }

  readRecent(rawScope: unknown, rawLimit: unknown) {
    const scope = this.scope(rawScope)
    const limit = parseMessageCacheLimit(rawLimit)
    return this.run(() => this.client.request({ kind: "readRecent", limit, scope }))
  }

  removeMessage(rawScope: unknown, rawMessageId: unknown, rawGeneration: unknown): Promise<void> {
    const scope = this.scope(rawScope)
    const messageId = parseMessageCacheId(rawMessageId)
    const generation = parseMessageCacheGeneration(rawGeneration)
    return this.run(() =>
      this.client.request({ generation, kind: "removeMessage", messageId, scope }),
    )
  }

  status(): Promise<MessageCacheStats> {
    return Promise.resolve(this.statusValue)
  }

  upsert(rawScope: unknown, rawRecords: unknown, rawGeneration: unknown): Promise<void> {
    const scope = this.scope(rawScope)
    const records = parseMessageCacheRecords(rawRecords, scope)
    const generation = parseMessageCacheGeneration(rawGeneration)
    return this.run(() => this.client.request({ generation, kind: "upsert", records, scope }))
  }

  private scope(value: unknown) {
    const scope = parseMessageCacheScope(value)
    this.requireProfile(scope.target)
    return scope
  }

  private target(value: unknown) {
    const target = parseMessageCacheTarget(value)
    this.requireProfile(target)
    return target
  }

  private requireProfile(
    target: Pick<{ id: string; normalizedUrl: string }, "id" | "normalizedUrl">,
  ) {
    const profile = this.profiles.require(target.id)
    if (profile.normalizedUrl !== target.normalizedUrl) {
      throw new MessageCacheError("cache_invalid_input", "本地消息缓存请求无效")
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.statusValue.status === "degraded") {
      if (this.now() < this.nextRecoveryAt) throw new MessageCacheError("cache_unavailable")
      this.statusValue = { ...this.statusValue, status: "rebuilding" }
      try {
        await this.client.recover()
        this.statusValue = await this.client.request<MessageCacheStats>({ kind: "health" })
      } catch (error) {
        const cacheError = toStableCacheError(error)
        this.markDegraded()
        throw cacheError
      }
    }
    try {
      const result = await operation()
      this.recoveryAttempts = 0
      this.nextRecoveryAt = 0
      if (this.statusValue.status !== "available") {
        this.statusValue = { ...this.statusValue, status: "available" }
      }
      return result
    } catch (error) {
      const cacheError = toStableCacheError(error)
      if (isAvailabilityFailure(cacheError.code)) this.markDegraded()
      throw cacheError
    }
  }

  private markDegraded(): void {
    const delay = Math.min(60_000, 1_000 * 2 ** this.recoveryAttempts)
    this.recoveryAttempts += 1
    this.nextRecoveryAt = this.now() + delay
    this.statusValue = { ...this.statusValue, status: "degraded" }
  }

  private startPendingServerClears(): void {
    if (this.closed || this.serverClearRun || this.pendingServerClears.size === 0) return
    if (this.serverClearRetry !== undefined) {
      clearTimeout(this.serverClearRetry)
      this.serverClearRetry = undefined
    }
    this.serverClearRun = this.flushPendingServerClears().finally(() => {
      this.serverClearRun = undefined
      if (!this.closed && this.pendingServerClears.size > 0) this.schedulePendingServerClears()
    })
  }

  private async flushPendingServerClears(): Promise<void> {
    for (const [key, target] of [...this.pendingServerClears]) {
      try {
        await this.run(() => this.client.request({ kind: "clearServer", target }))
        if (this.pendingServerClears.get(key) === target) this.pendingServerClears.delete(key)
      } catch {
        return
      }
    }
  }

  private schedulePendingServerClears(): void {
    if (this.closed || this.serverClearRetry !== undefined) return
    const delay = Math.max(1_000, Math.min(60_000, this.nextRecoveryAt - this.now()))
    this.serverClearRetry = setTimeout(() => {
      this.serverClearRetry = undefined
      this.startPendingServerClears()
    }, delay)
    this.serverClearRetry.unref?.()
  }
}

interface MessageCacheWorkerPort {
  close(): Promise<void>
  recover(): Promise<void>
  reopen(): Promise<void>
  request<T>(operation: MessageCacheWorkerOperation): Promise<T>
}

function toStableCacheError(error: unknown): MessageCacheError {
  return error instanceof MessageCacheError ? error : new MessageCacheError("cache_unavailable")
}

function isAvailabilityFailure(code: MessageCacheError["code"]): boolean {
  return code !== "cache_generation_stale" && code !== "cache_invalid_input"
}

function invalidCommit(): never {
  throw new MessageCacheError("cache_invalid_input", "本地消息缓存请求无效")
}

function serverClearKey(target: Readonly<{ id: string; normalizedUrl: string }>): string {
  return `${target.id}\u0000${target.normalizedUrl}`
}
