import type { AuthenticatedTarget } from "@shared/client-contract"

export const MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION = 1 as const
export const MESSAGE_CACHE_SCHEMA_VERSION = 2 as const

export const MESSAGE_CACHE_LIMITS = Object.freeze({
  globalBytes: 200 * 1024 * 1024,
  idLength: 128,
  maxBatchBytes: 4 * 1024 * 1024,
  maxBatchRecords: 100,
  maxPageRecords: 100,
  maxPayloadBytes: 512 * 1024,
  maxSeq: Number.MAX_SAFE_INTEGER,
  perConversationRecords: 3_000,
})

export type MessageCacheStatus = "available" | "degraded" | "rebuilding"

export type MessageCacheErrorCode =
  | "cache_busy"
  | "cache_closed"
  | "cache_corrupt"
  | "cache_disk_full"
  | "cache_generation_stale"
  | "cache_invalid_input"
  | "cache_migration_failed"
  | "cache_permission_denied"
  | "cache_schema_too_new"
  | "cache_timeout"
  | "cache_unavailable"
  | "cache_worker_failed"

export type MessageCacheScope = Readonly<{
  conversationId: string
  target: AuthenticatedTarget
}>

export type MessageCacheGeneration = Readonly<{
  conversation: number
  global: number
  server: number
  user: number
}>

export type MessageCacheRecord = Readonly<{
  cachedAt: number
  conversationId: string
  createdAt: string
  messageId: string
  payloadJson: string
  payloadSchemaVersion: number
  reactionVersion: number
  seq: number
}>

export type MessageCachePage = Readonly<{
  complete: boolean
  hasMoreBefore: boolean
  messages: ReadonlyArray<MessageCacheRecord>
  newestSeq: number
  oldestSeq: number
}>

export type MessageCacheSyncState = Readonly<{
  conversationId: string
  generation: MessageCacheGeneration
  hasMoreBefore: boolean
  httpSyncedThroughSeq: number
  lastAccessedAt: number
  lastSyncedAt?: number
  oldestCachedSeq?: number
}>

export type MessageCacheStats = Readonly<{
  conversationCount: number
  messageCount: number
  payloadBytes: number
  status: MessageCacheStatus
}>

export type MessageCacheCommit = Readonly<{
  generation: MessageCacheGeneration
  hasMoreBefore: boolean
  records: ReadonlyArray<MessageCacheRecord>
  requestAfterSeq?: number
  requestBeforeSeq?: number
}>

export type MessageCacheCommitResult = Readonly<{
  committed: boolean
  committedSeq: number
  generation: MessageCacheGeneration
}>

export interface MessageCacheBridge {
  clearConversation(scope: MessageCacheScope): Promise<MessageCacheGeneration>
  clearUser(target: AuthenticatedTarget): Promise<void>
  commitAfter(
    scope: MessageCacheScope,
    input: MessageCacheCommit,
  ): Promise<MessageCacheCommitResult>
  commitBefore(
    scope: MessageCacheScope,
    input: MessageCacheCommit,
  ): Promise<MessageCacheCommitResult>
  commitLatest(
    scope: MessageCacheScope,
    input: MessageCacheCommit,
  ): Promise<MessageCacheCommitResult>
  getById(scope: MessageCacheScope, messageId: string): Promise<MessageCacheRecord | null>
  getStats(target: AuthenticatedTarget): Promise<MessageCacheStats>
  getSyncState(scope: MessageCacheScope): Promise<MessageCacheSyncState>
  listSyncStates(target: AuthenticatedTarget): Promise<ReadonlyArray<MessageCacheSyncState>>
  readBefore(scope: MessageCacheScope, beforeSeq: number, limit: number): Promise<MessageCachePage>
  readRecent(scope: MessageCacheScope, limit: number): Promise<MessageCachePage>
  removeMessage(
    scope: MessageCacheScope,
    messageId: string,
    generation: MessageCacheGeneration,
  ): Promise<void>
  upsert(
    scope: MessageCacheScope,
    records: ReadonlyArray<MessageCacheRecord>,
    generation: MessageCacheGeneration,
  ): Promise<void>
}

export class MessageCacheError extends Error {
  readonly code: MessageCacheErrorCode

  constructor(code: MessageCacheErrorCode, message = "本地消息缓存暂时不可用") {
    super(message)
    this.name = "MessageCacheError"
    this.code = code
  }
}
