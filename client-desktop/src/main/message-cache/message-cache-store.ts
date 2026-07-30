import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import {
  MESSAGE_CACHE_LIMITS,
  MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION,
  type MessageCacheCommit,
  type MessageCacheCommitResult,
  type MessageCacheGeneration,
  type MessageCachePage,
  type MessageCacheRecord,
  type MessageCacheScope,
  type MessageCacheStats,
  type MessageCacheSyncState,
} from "@shared/message-cache-contract"
import type { AuthenticatedTarget } from "@shared/client-contract"
import { removeIsolatedDatabaseFiles } from "./message-cache-isolation"
import { migrateMessageCache } from "./message-cache-migrations"

type ScopeColumns = Readonly<{
  conversationId: string
  serverKey: string
  userId: string
}>

type MessageRow = Readonly<{
  cached_at: number
  conversation_id: string
  created_at: string
  message_id: string
  payload_json: string
  payload_schema_version: number
  reaction_version: number
  seq: number
}>

type SyncRow = Readonly<{
  conversation_id: string
  has_more_before: number
  http_synced_through_seq: number
  last_accessed_at: number
  last_synced_at: number | null
  oldest_cached_seq: number | null
}>

const rowOverheadBytes = 256
const globalGenerationKey = "global"

export class MessageCacheStore {
  readonly database: DatabaseSync
  private lastMaintenanceAt = 0

  constructor(
    private readonly databasePath: string,
    private readonly limits: Readonly<{
      globalBytes: number
      maintenanceIntervalMs: number
      perConversationRecords: number
    }> = {
      globalBytes: MESSAGE_CACHE_LIMITS.globalBytes,
      maintenanceIntervalMs: 60_000,
      perConversationRecords: MESSAGE_CACHE_LIMITS.perConversationRecords,
    },
  ) {
    this.database = new DatabaseSync(databasePath)
    try {
      this.database.exec("PRAGMA journal_mode = WAL")
      this.database.exec("PRAGMA foreign_keys = ON")
      this.database.exec("PRAGMA busy_timeout = 5000")
      this.database.exec("PRAGMA synchronous = NORMAL")
      migrateMessageCache(this.database)
    } catch (error) {
      try {
        this.database.close()
      } catch {
        // 初始化错误优先，关闭失败不应掩盖数据库无法打开或迁移的原因。
      }
      throw error
    }
  }

  close(): void {
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    this.database.close()
  }

  health(): MessageCacheStats {
    this.database.prepare("SELECT 1").get()
    return this.getStats()
  }

  readRecent(scope: MessageCacheScope, limit: number): MessageCachePage {
    const key = columns(scope)
    const rows = this.database
      .prepare(
        `SELECT conversation_id, message_id, seq, reaction_version,
                payload_schema_version, payload_json, created_at, cached_at
           FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          ORDER BY seq DESC LIMIT ?`,
      )
      .all(key.serverKey, key.userId, key.conversationId, limit) as MessageRow[]
    this.touch(key)
    return this.page(scope, rows.reverse())
  }

  readBefore(scope: MessageCacheScope, beforeSeq: number, limit: number): MessageCachePage {
    const key = columns(scope)
    const state = this.syncRow(key)
    if (!state) return cacheMissPage()
    if (state.oldest_cached_seq !== null && beforeSeq <= state.oldest_cached_seq) {
      return this.page(scope, [])
    }
    if (beforeSeq > state.http_synced_through_seq + 1) return cacheMissPage()
    const rows = this.database
      .prepare(
        `SELECT conversation_id, message_id, seq, reaction_version,
                payload_schema_version, payload_json, created_at, cached_at
           FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ? AND seq < ?
          ORDER BY seq DESC LIMIT ?`,
      )
      .all(key.serverKey, key.userId, key.conversationId, beforeSeq, limit) as MessageRow[]
    this.touch(key)
    return this.page(scope, rows.reverse())
  }

  getById(scope: MessageCacheScope, messageId: string): MessageCacheRecord | null {
    const key = columns(scope)
    const row = this.database
      .prepare(
        `SELECT conversation_id, message_id, seq, reaction_version,
                payload_schema_version, payload_json, created_at, cached_at
           FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ? AND message_id = ?`,
      )
      .get(key.serverKey, key.userId, key.conversationId, messageId) as MessageRow | undefined
    if (!row) return null
    const record = this.record(row)
    if (!record) this.deleteCorruptRow(key, messageId)
    return record
  }

  getSyncState(scope: MessageCacheScope): MessageCacheSyncState {
    const key = columns(scope)
    const row = this.syncRow(key)
    return toSyncState(key.conversationId, row, this.generation(key))
  }

  listSyncStates(target: AuthenticatedTarget): MessageCacheSyncState[] {
    const serverKey = createServerKey(target)
    const rows = this.database
      .prepare(
        `SELECT conversation_id, http_synced_through_seq, oldest_cached_seq,
                has_more_before, last_synced_at, last_accessed_at
           FROM message_sync_state
          WHERE server_key = ? AND user_id = ?
          ORDER BY last_accessed_at DESC`,
      )
      .all(serverKey, target.userId) as SyncRow[]
    return rows.map((row) =>
      toSyncState(
        row.conversation_id,
        row,
        this.generation({ conversationId: row.conversation_id, serverKey, userId: target.userId }),
      ),
    )
  }

  getStats(target?: AuthenticatedTarget): MessageCacheStats {
    const row = target
      ? (this.database
          .prepare(
            `SELECT COUNT(*) AS conversation_count,
                    COALESCE(SUM(message_count), 0) AS message_count,
                    COALESCE(SUM(payload_bytes), 0) AS payload_bytes
               FROM message_cache_stats WHERE server_key = ? AND user_id = ?`,
          )
          .get(createServerKey(target), target.userId) as StatsRow)
      : (this.database
          .prepare(
            `SELECT COUNT(*) AS conversation_count,
                    COALESCE(SUM(message_count), 0) AS message_count,
                    COALESCE(SUM(payload_bytes), 0) AS payload_bytes
               FROM message_cache_stats`,
          )
          .get() as StatsRow)
    return {
      conversationCount: Number(row.conversation_count),
      messageCount: Number(row.message_count),
      payloadBytes: Number(row.payload_bytes),
      status: "available",
    }
  }

  upsert(
    scope: MessageCacheScope,
    records: ReadonlyArray<MessageCacheRecord>,
    generation: MessageCacheGeneration,
  ): void {
    const key = columns(scope)
    this.transaction(() => {
      this.assertGeneration(key, generation)
      this.upsertRecords(key, records)
      this.ensureSyncState(key)
      this.trimConversation(key)
      this.rebuildStats(key)
    })
    this.maintainIfDue()
  }

  commitLatest(scope: MessageCacheScope, commit: MessageCacheCommit): MessageCacheCommitResult {
    const key = columns(scope)
    return this.commit(key, commit, "latest")
  }

  commitBefore(scope: MessageCacheScope, commit: MessageCacheCommit): MessageCacheCommitResult {
    const key = columns(scope)
    return this.commit(key, commit, "before")
  }

  commitAfter(scope: MessageCacheScope, commit: MessageCacheCommit): MessageCacheCommitResult {
    const key = columns(scope)
    return this.commit(key, commit, "after")
  }

  removeMessage(
    scope: MessageCacheScope,
    messageId: string,
    generation: MessageCacheGeneration,
  ): void {
    const key = columns(scope)
    this.transaction(() => {
      this.assertGeneration(key, generation)
      this.database
        .prepare(
          `DELETE FROM cached_messages
            WHERE server_key = ? AND user_id = ? AND conversation_id = ? AND message_id = ?`,
        )
        .run(key.serverKey, key.userId, key.conversationId, messageId)
      this.repairBoundaries(key)
      this.rebuildStats(key)
    })
  }

  clearConversation(scope: MessageCacheScope): MessageCacheGeneration {
    const key = columns(scope)
    this.transaction(() => {
      this.bumpGeneration(conversationGenerationKey(key))
      this.deleteConversation(key)
    })
    removeIsolatedDatabaseFiles(this.databasePath)
    return this.generation(key)
  }

  clearUser(target: AuthenticatedTarget): void {
    const serverKey = createServerKey(target)
    this.transaction(() => {
      this.bumpGeneration(userGenerationKey(serverKey, target.userId))
      this.database
        .prepare("DELETE FROM cached_messages WHERE server_key = ? AND user_id = ?")
        .run(serverKey, target.userId)
      this.database
        .prepare("DELETE FROM message_sync_state WHERE server_key = ? AND user_id = ?")
        .run(serverKey, target.userId)
      this.database
        .prepare("DELETE FROM message_cache_stats WHERE server_key = ? AND user_id = ?")
        .run(serverKey, target.userId)
    })
    removeIsolatedDatabaseFiles(this.databasePath)
  }

  clearServer(target: Pick<AuthenticatedTarget, "id" | "normalizedUrl">): void {
    const serverKey = createServerKey(target)
    this.transaction(() => {
      this.clearServerKey(serverKey)
    })
    removeIsolatedDatabaseFiles(this.databasePath)
  }

  clearOrphanedServers(
    targets: ReadonlyArray<Pick<AuthenticatedTarget, "id" | "normalizedUrl">>,
  ): void {
    const activeServerKeys = new Set(targets.map(createServerKey))
    const cachedServerKeys = this.database
      .prepare(
        `SELECT server_key FROM cached_messages
         UNION SELECT server_key FROM message_sync_state
         UNION SELECT server_key FROM message_cache_stats`,
      )
      .all() as Array<Readonly<{ server_key: string }>>
    const orphanedServerKeys = cachedServerKeys
      .map((row) => row.server_key)
      .filter((serverKey) => !activeServerKeys.has(serverKey))
    if (orphanedServerKeys.length > 0) {
      this.transaction(() => {
        for (const serverKey of orphanedServerKeys) this.clearServerKey(serverKey)
      })
    }
    removeIsolatedDatabaseFiles(this.databasePath)
  }

  clearAll(): void {
    this.transaction(() => {
      this.bumpGeneration(globalGenerationKey)
      this.database.exec(`
        DELETE FROM cached_messages;
        DELETE FROM message_sync_state;
        DELETE FROM message_cache_stats;
      `)
    })
    removeIsolatedDatabaseFiles(this.databasePath)
  }

  private commit(
    key: ScopeColumns,
    commit: MessageCacheCommit,
    kind: "after" | "before" | "latest",
  ): MessageCacheCommitResult {
    let committed = false
    let committedSeq = 0
    let accepted = false
    this.transaction(() => {
      this.assertGeneration(key, commit.generation)
      const previous = this.syncRow(key)
      const newest = maximumSeq(commit.records)
      const oldest = minimumSeq(commit.records)
      const now = Date.now()

      if (kind === "latest" && (!previous || previous.last_synced_at === null)) {
        accepted = true
        committed = true
        committedSeq = newest
        this.upsertRecords(key, commit.records)
        this.writeSyncState(key, newest, oldest, commit.hasMoreBefore, now)
      } else if (kind === "latest" && previous) {
        accepted = true
        committedSeq = previous.http_synced_through_seq
        this.upsertRecords(key, commit.records)
      } else if (kind === "after" && previous) {
        committedSeq = previous.http_synced_through_seq
        if (commit.requestAfterSeq === previous.http_synced_through_seq) {
          accepted = true
          committed = true
          committedSeq = Math.max(previous.http_synced_through_seq, newest)
          this.upsertRecords(key, commit.records)
          this.writeSyncState(
            key,
            committedSeq,
            previous.oldest_cached_seq ?? oldest,
            Boolean(previous.has_more_before),
            now,
          )
        }
      } else if (kind === "before" && previous) {
        committedSeq = previous.http_synced_through_seq
        if (commit.requestBeforeSeq === previous.oldest_cached_seq) {
          accepted = true
          committed = true
          this.upsertRecords(key, commit.records)
          this.writeSyncState(
            key,
            previous.http_synced_through_seq,
            oldest || previous.oldest_cached_seq,
            commit.hasMoreBefore,
            now,
          )
        }
      } else {
        committedSeq = previous?.http_synced_through_seq ?? 0
      }
      if (accepted) {
        this.trimConversation(key)
        this.rebuildStats(key)
      }
    })
    this.maintainIfDue()
    return { committed, committedSeq, generation: this.generation(key) }
  }

  private upsertRecords(key: ScopeColumns, records: ReadonlyArray<MessageCacheRecord>): void {
    const statement = this.database.prepare(
      `INSERT INTO cached_messages (
         server_key, user_id, conversation_id, message_id, seq, reaction_version,
         payload_schema_version, payload_json, payload_bytes, created_at, cached_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_key, user_id, conversation_id, message_id) DO UPDATE SET
         seq = excluded.seq,
         reaction_version = excluded.reaction_version,
         payload_schema_version = excluded.payload_schema_version,
         payload_json = excluded.payload_json,
         payload_bytes = excluded.payload_bytes,
         created_at = excluded.created_at,
         cached_at = excluded.cached_at`,
    )
    for (const record of records) {
      statement.run(
        key.serverKey,
        key.userId,
        key.conversationId,
        record.messageId,
        record.seq,
        record.reactionVersion,
        record.payloadSchemaVersion,
        record.payloadJson,
        Buffer.byteLength(record.payloadJson),
        record.createdAt,
        record.cachedAt,
      )
    }
  }

  private page(scope: MessageCacheScope, rows: MessageRow[]): MessageCachePage {
    const messages: MessageCacheRecord[] = []
    const corruptIds: string[] = []
    for (const row of rows) {
      const record = this.record(row)
      if (record) messages.push(record)
      else corruptIds.push(row.message_id)
    }
    if (corruptIds.length > 0) {
      const key = columns(scope)
      this.transaction(() => {
        for (const id of corruptIds) this.deleteCorruptRow(key, id)
        this.repairBoundaries(key)
        this.rebuildStats(key)
      })
    }
    const state = this.syncRow(columns(scope))
    return {
      complete: corruptIds.length === 0,
      hasMoreBefore: Boolean(state?.has_more_before),
      messages,
      newestSeq: messages.at(-1)?.seq ?? 0,
      oldestSeq: messages[0]?.seq ?? 0,
    }
  }

  private record(row: MessageRow): MessageCacheRecord | null {
    if (row.payload_schema_version !== MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION) return null
    try {
      JSON.parse(row.payload_json)
    } catch {
      return null
    }
    return {
      cachedAt: row.cached_at,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
      messageId: row.message_id,
      payloadJson: row.payload_json,
      payloadSchemaVersion: row.payload_schema_version,
      reactionVersion: row.reaction_version,
      seq: row.seq,
    }
  }

  private ensureSyncState(key: ScopeColumns): void {
    const now = Date.now()
    this.database
      .prepare(
        `INSERT INTO message_sync_state (
           server_key, user_id, conversation_id, last_accessed_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(server_key, user_id, conversation_id) DO UPDATE SET
           last_accessed_at = excluded.last_accessed_at`,
      )
      .run(key.serverKey, key.userId, key.conversationId, now)
  }

  private writeSyncState(
    key: ScopeColumns,
    syncedThrough: number,
    oldest: number | null,
    hasMoreBefore: boolean,
    now: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO message_sync_state (
           server_key, user_id, conversation_id, http_synced_through_seq,
           oldest_cached_seq, has_more_before, last_synced_at, last_accessed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_key, user_id, conversation_id) DO UPDATE SET
           http_synced_through_seq = excluded.http_synced_through_seq,
           oldest_cached_seq = excluded.oldest_cached_seq,
           has_more_before = excluded.has_more_before,
           last_synced_at = excluded.last_synced_at,
           last_accessed_at = excluded.last_accessed_at`,
      )
      .run(
        key.serverKey,
        key.userId,
        key.conversationId,
        syncedThrough,
        oldest || null,
        hasMoreBefore ? 1 : 0,
        now,
        now,
      )
  }

  private trimConversation(key: ScopeColumns): void {
    const count = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
      )
      .get(key.serverKey, key.userId, key.conversationId) as Readonly<{ count: number }>
    const excess = Number(count.count) - this.limits.perConversationRecords
    if (excess <= 0) return
    this.database
      .prepare(
        `DELETE FROM cached_messages WHERE rowid IN (
           SELECT rowid FROM cached_messages
            WHERE server_key = ? AND user_id = ? AND conversation_id = ?
            ORDER BY seq ASC LIMIT ?
         )`,
      )
      .run(key.serverKey, key.userId, key.conversationId, excess)
    this.repairBoundaries(key, true)
  }

  private repairBoundaries(key: ScopeColumns, trimmed = false): void {
    const row = this.database
      .prepare(
        `SELECT MIN(seq) AS oldest FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
      )
      .get(key.serverKey, key.userId, key.conversationId) as Readonly<{
      oldest: number | null
    }>
    this.database
      .prepare(
        `UPDATE message_sync_state SET oldest_cached_seq = ?,
           has_more_before = CASE WHEN ? THEN 1 ELSE has_more_before END
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
      )
      .run(row.oldest, trimmed ? 1 : 0, key.serverKey, key.userId, key.conversationId)
  }

  private rebuildStats(key: ScopeColumns): void {
    this.database
      .prepare(
        `INSERT INTO message_cache_stats (
           server_key, user_id, conversation_id, message_count, payload_bytes
         )
         SELECT ?, ?, ?, COUNT(*), COALESCE(SUM(payload_bytes + ?), 0)
           FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?
         ON CONFLICT(server_key, user_id, conversation_id) DO UPDATE SET
           message_count = excluded.message_count,
           payload_bytes = excluded.payload_bytes`,
      )
      .run(
        key.serverKey,
        key.userId,
        key.conversationId,
        rowOverheadBytes,
        key.serverKey,
        key.userId,
        key.conversationId,
      )
  }

  private maintainIfDue(): void {
    const now = Date.now()
    if (now - this.lastMaintenanceAt < this.limits.maintenanceIntervalMs) return
    this.lastMaintenanceAt = now
    let total = this.getStats().payloadBytes
    while (total > this.limits.globalBytes) {
      const oldest = this.database
        .prepare(
          `SELECT server_key, user_id, conversation_id
             FROM message_sync_state ORDER BY last_accessed_at ASC LIMIT 1`,
        )
        .get() as
        | Readonly<{ conversation_id: string; server_key: string; user_id: string }>
        | undefined
      if (!oldest) break
      this.transaction(() =>
        this.deleteConversation({
          conversationId: oldest.conversation_id,
          serverKey: oldest.server_key,
          userId: oldest.user_id,
        }),
      )
      total = this.getStats().payloadBytes
    }
    this.database.exec("PRAGMA wal_checkpoint(PASSIVE)")
  }

  private deleteConversation(key: ScopeColumns): void {
    for (const table of ["cached_messages", "message_sync_state", "message_cache_stats"]) {
      this.database
        .prepare(
          `DELETE FROM ${table} WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
        )
        .run(key.serverKey, key.userId, key.conversationId)
    }
  }

  private deleteCorruptRow(key: ScopeColumns, messageId: string): void {
    this.database
      .prepare(
        `DELETE FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ? AND message_id = ?`,
      )
      .run(key.serverKey, key.userId, key.conversationId, messageId)
  }

  private touch(key: ScopeColumns): void {
    this.database
      .prepare(
        `UPDATE message_sync_state SET last_accessed_at = ?
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
      )
      .run(Date.now(), key.serverKey, key.userId, key.conversationId)
  }

  private syncRow(key: ScopeColumns): SyncRow | undefined {
    return this.database
      .prepare(
        `SELECT conversation_id, http_synced_through_seq, oldest_cached_seq,
                has_more_before, last_synced_at, last_accessed_at
           FROM message_sync_state
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
      )
      .get(key.serverKey, key.userId, key.conversationId) as SyncRow | undefined
  }

  private generation(key: ScopeColumns): MessageCacheGeneration {
    return {
      conversation: this.generationValue(conversationGenerationKey(key)),
      global: this.generationValue(globalGenerationKey),
      server: this.generationValue(serverGenerationKey(key.serverKey)),
      user: this.generationValue(userGenerationKey(key.serverKey, key.userId)),
    }
  }

  private assertGeneration(key: ScopeColumns, expected: MessageCacheGeneration): void {
    const current = this.generation(key)
    if (
      current.global !== expected.global ||
      current.server !== expected.server ||
      current.user !== expected.user ||
      current.conversation !== expected.conversation
    ) {
      throw new Error("cache generation is stale")
    }
    for (const scopeKey of [
      globalGenerationKey,
      serverGenerationKey(key.serverKey),
      userGenerationKey(key.serverKey, key.userId),
      conversationGenerationKey(key),
    ]) {
      this.database
        .prepare(
          "INSERT OR IGNORE INTO message_cache_generations (scope_key, generation) VALUES (?, 0)",
        )
        .run(scopeKey)
    }
  }

  private generationValue(scopeKey: string): number {
    const row = this.database
      .prepare("SELECT generation FROM message_cache_generations WHERE scope_key = ?")
      .get(scopeKey) as Readonly<{ generation: number }> | undefined
    return row?.generation ?? 0
  }

  private bumpGeneration(scopeKey: string): void {
    this.database
      .prepare(
        `INSERT INTO message_cache_generations (scope_key, generation) VALUES (?, 1)
         ON CONFLICT(scope_key) DO UPDATE SET generation = generation + 1`,
      )
      .run(scopeKey)
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const result = operation()
      this.database.exec("COMMIT")
      return result
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }

  private clearServerKey(serverKey: string): void {
    this.bumpGeneration(serverGenerationKey(serverKey))
    this.database.prepare("DELETE FROM cached_messages WHERE server_key = ?").run(serverKey)
    this.database.prepare("DELETE FROM message_sync_state WHERE server_key = ?").run(serverKey)
    this.database.prepare("DELETE FROM message_cache_stats WHERE server_key = ?").run(serverKey)
  }
}

type StatsRow = Readonly<{
  conversation_count: number
  message_count: number
  payload_bytes: number
}>

function columns(scope: MessageCacheScope): ScopeColumns {
  return {
    conversationId: scope.conversationId,
    serverKey: createServerKey(scope.target),
    userId: scope.target.userId,
  }
}

function cacheMissPage(): MessageCachePage {
  return {
    complete: false,
    hasMoreBefore: true,
    messages: [],
    newestSeq: 0,
    oldestSeq: 0,
  }
}

export function createServerKey(target: Pick<AuthenticatedTarget, "id" | "normalizedUrl">): string {
  return createHash("sha256").update(`${target.id}\u0000${target.normalizedUrl}`).digest("hex")
}

function toSyncState(
  conversationId: string,
  row: SyncRow | undefined,
  generation: MessageCacheGeneration,
): MessageCacheSyncState {
  return {
    conversationId,
    generation,
    hasMoreBefore: row ? Boolean(row.has_more_before) : true,
    httpSyncedThroughSeq: row?.http_synced_through_seq ?? 0,
    lastAccessedAt: row?.last_accessed_at ?? Date.now(),
    lastSyncedAt: row?.last_synced_at ?? undefined,
    oldestCachedSeq: row?.oldest_cached_seq ?? undefined,
  }
}

function maximumSeq(records: ReadonlyArray<MessageCacheRecord>): number {
  return records.reduce((maximum, record) => Math.max(maximum, record.seq), 0)
}

function minimumSeq(records: ReadonlyArray<MessageCacheRecord>): number {
  return records.reduce(
    (minimum, record) => (minimum === 0 ? record.seq : Math.min(minimum, record.seq)),
    0,
  )
}

function serverGenerationKey(serverKey: string): string {
  return `server:${serverKey}`
}

function userGenerationKey(serverKey: string, userId: string): string {
  return `user:${serverKey}:${userId}`
}

function conversationGenerationKey(key: ScopeColumns): string {
  return `conversation:${key.serverKey}:${key.userId}:${key.conversationId}`
}
