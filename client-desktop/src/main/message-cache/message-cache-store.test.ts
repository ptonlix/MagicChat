// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import type { MessageCacheGeneration, MessageCacheScope } from "@shared/message-cache-contract"
import { MessageCacheStore } from "./message-cache-store"
import { openMessageCacheStore } from "./message-cache-database"

const directories: string[] = []
const generation: MessageCacheGeneration = { conversation: 0, server: 0, user: 0 }
const scope: MessageCacheScope = {
  conversationId: "conversation-1",
  target: { id: "server-1", normalizedUrl: "https://chat.example.com", userId: "user-1" },
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("SQLite 消息缓存事务", () => {
  it("latest 初始化游标，realtime 不推进，after 只按 CAS 连续推进", async () => {
    const store = await createStore()
    expect(
      store.commitLatest(scope, {
        generation,
        hasMoreBefore: true,
        records: [record(9), record(10)],
      }),
    ).toMatchObject({ committed: true, committedSeq: 10 })

    store.upsert(scope, [record(15)], generation)
    expect(store.getSyncState(scope).httpSyncedThroughSeq).toBe(10)

    expect(
      store.commitAfter(scope, {
        generation,
        hasMoreBefore: true,
        records: [record(11), record(12)],
        requestAfterSeq: 10,
      }),
    ).toMatchObject({ committed: true, committedSeq: 12 })
    expect(
      store.commitAfter(scope, {
        generation,
        hasMoreBefore: true,
        records: [record(13)],
        requestAfterSeq: 10,
      }),
    ).toMatchObject({ committed: false, committedSeq: 12 })
    store.close()
  })

  it("页面和游标崩溃重开后保持一致，重复页面不产生重复消息", async () => {
    const { databasePath, store } = await createStoreWithPath()
    store.commitLatest(scope, {
      generation,
      hasMoreBefore: false,
      records: [record(1), record(2)],
    })
    store.commitLatest(scope, {
      generation,
      hasMoreBefore: false,
      records: [record(1), record(2)],
    })
    store.close()

    const reopened = new MessageCacheStore(databasePath)
    expect(reopened.readRecent(scope, 20).messages).toHaveLength(2)
    expect(reopened.getSyncState(scope).httpSyncedThroughSeq).toBe(2)
    reopened.close()
  })

  it("清理递增 generation 并拒绝迟到写入", async () => {
    const store = await createStore()
    store.commitLatest(scope, { generation, hasMoreBefore: true, records: [record(1)] })
    const nextGeneration = store.clearConversation(scope)
    expect(nextGeneration.conversation).toBe(1)
    expect(() => store.upsert(scope, [record(2)], generation)).toThrow("generation")
    store.upsert(scope, [record(2)], nextGeneration)
    expect(store.readRecent(scope, 20).messages.map((item) => item.seq)).toEqual([2])
    store.close()
  })

  it("用户和 Server 清理隔离其他作用域并拒绝各自迟到写入", async () => {
    const store = await createStore()
    const otherUserScope = {
      ...scope,
      target: { ...scope.target, userId: "user-2" },
    }
    store.upsert(scope, [record(1)], generation)
    store.upsert(otherUserScope, [record(2)], generation)
    store.clearUser(scope.target)
    expect(store.readRecent(scope, 20).messages).toEqual([])
    expect(store.readRecent(otherUserScope, 20).messages).toHaveLength(1)
    expect(() => store.upsert(scope, [record(3)], generation)).toThrow("generation")

    store.clearServer(scope.target)
    expect(store.readRecent(otherUserScope, 20).messages).toEqual([])
    expect(() => store.upsert(otherUserScope, [record(4)], generation)).toThrow("generation")
    store.close()
  })

  it("页面事务失败时同时回滚消息和游标", async () => {
    const store = await createStore()
    expect(() =>
      store.commitLatest(scope, {
        generation,
        hasMoreBefore: true,
        records: [record(1), { ...record(2), seq: 1 }],
      }),
    ).toThrow()
    expect(store.readRecent(scope, 20).messages).toEqual([])
    expect(store.getSyncState(scope).httpSyncedThroughSeq).toBe(0)
    store.close()
  })

  it("隔离损坏 payload 行且不影响同页正常记录", async () => {
    const store = await createStore()
    store.commitLatest(scope, {
      generation,
      hasMoreBefore: true,
      records: [record(1), record(2)],
    })
    store.database
      .prepare("UPDATE cached_messages SET payload_json = 'invalid' WHERE seq = 1")
      .run()
    expect(store.readRecent(scope, 20).messages.map((item) => item.seq)).toEqual([2])
    expect(store.getStats(scope.target).messageCount).toBe(1)
    store.close()
  })

  it("每会话超过 3000 条时裁剪最旧消息并恢复服务端历史边界", async () => {
    const store = await createStore()
    for (let offset = 0; offset < 31; offset += 1) {
      const records = Array.from({ length: 100 }, (_, index) => record(offset * 100 + index + 1))
      store.upsert(scope, records, generation)
    }
    const page = store.readRecent(scope, 100)
    expect(store.getStats(scope.target).messageCount).toBe(3_000)
    expect(page.messages.at(-1)?.seq).toBe(3_100)
    expect(store.getSyncState(scope)).toMatchObject({ hasMoreBefore: true, oldestCachedSeq: 101 })
    store.close()
  })

  it("逻辑容量超限时按最近访问淘汰整个冷会话", async () => {
    const created = await createStoreWithPath()
    created.store.close()
    const { databasePath } = created
    const store = new MessageCacheStore(databasePath, {
      globalBytes: 900,
      maintenanceIntervalMs: 0,
      perConversationRecords: 3_000,
    })
    const coldScope = scope
    const hotScope = { ...scope, conversationId: "conversation-2" }
    store.upsert(coldScope, [record(1), record(2)], generation)
    store.upsert(
      hotScope,
      [
        { ...record(3), conversationId: hotScope.conversationId },
        { ...record(4), conversationId: hotScope.conversationId },
      ],
      generation,
    )
    expect(store.readRecent(coldScope, 20).messages).toEqual([])
    expect(store.readRecent(hotScope, 20).messages).toHaveLength(2)
    store.close()
  })

  it("后续事务会修复当前会话统计漂移", async () => {
    const store = await createStore()
    store.upsert(scope, [record(1)], generation)
    store.database.prepare("UPDATE message_cache_stats SET message_count = 999").run()
    store.upsert(scope, [record(2)], generation)
    expect(store.getStats(scope.target).messageCount).toBe(2)
    store.close()
  })

  it("payload schema 不兼容时只重建消息缓存", async () => {
    const { databasePath, store } = await createStoreWithPath()
    store.commitLatest(scope, { generation, hasMoreBefore: true, records: [record(1)] })
    store.close()
    const database = new DatabaseSync(databasePath)
    database
      .prepare("UPDATE message_cache_metadata SET value = 0 WHERE key = 'payload_schema_version'")
      .run()
    database.close()

    const migrated = new MessageCacheStore(databasePath)
    expect(migrated.readRecent(scope, 20).messages).toEqual([])
    expect(migrated.getSyncState(scope).httpSyncedThroughSeq).toBe(0)
    migrated.close()
  })

  it("未知高版本 schema 被隔离并创建新库", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-message-cache-"))
    directories.push(directory)
    const databasePath = path.join(directory, "messages.sqlite3")
    const database = new DatabaseSync(databasePath)
    database.exec("PRAGMA user_version = 99")
    database.close()

    const rebuilt = openMessageCacheStore(databasePath)
    expect(rebuilt.health().status).toBe("available")
    rebuilt.close()
    expect((await readdir(directory)).some((name) => name.includes(".isolated-"))).toBe(true)
  })
})

async function createStore() {
  return (await createStoreWithPath()).store
}

async function createStoreWithPath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-message-cache-"))
  directories.push(directory)
  const databasePath = path.join(directory, "messages.sqlite3")
  return { databasePath, store: new MessageCacheStore(databasePath) }
}

function record(seq: number) {
  return {
    cachedAt: Date.now(),
    conversationId: scope.conversationId,
    createdAt: "2026-07-29T00:00:00Z",
    messageId: `message-${seq}`,
    payloadJson: JSON.stringify({ id: `message-${seq}`, seq }),
    payloadSchemaVersion: 1,
    reactionVersion: 0,
    seq,
  }
}
