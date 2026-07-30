// @vitest-environment node
import { renameSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import type { MessageCacheGeneration, MessageCacheScope } from "@shared/message-cache-contract"
import { MessageCacheStore } from "./message-cache-store"
import { openMessageCacheStore } from "./message-cache-database"
import { isolateDatabaseFiles } from "./message-cache-isolation"

const directories: string[] = []
const generation: MessageCacheGeneration = { conversation: 0, global: 0, server: 0, user: 0 }
const scope: MessageCacheScope = {
  conversationId: "conversation-1",
  target: { id: "server-1", normalizedUrl: "https://chat.example.com", userId: "user-1" },
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("SQLite 消息缓存事务", () => {
  it("没有同步状态时历史空页必须标记为缓存未命中", async () => {
    const store = await createStore()

    expect(store.readBefore(scope, 100, 20)).toMatchObject({
      complete: false,
      hasMoreBefore: true,
      messages: [],
    })
    store.close()
  })

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

  it("全量清理使未登记作用域的旧 generation 失效并允许新 generation 写入", async () => {
    const store = await createStore()
    const staleGeneration = store.getSyncState(scope).generation
    expect(staleGeneration).toEqual(generation)

    store.clearAll()

    expect(() => store.upsert(scope, [record(1)], staleGeneration)).toThrow("generation")
    expect(store.readRecent(scope, 20).messages).toEqual([])
    const currentGeneration = store.getSyncState(scope).generation
    expect(currentGeneration).toEqual({ ...generation, global: 1 })
    store.upsert(scope, [record(1)], currentGeneration)
    expect(store.readRecent(scope, 20).messages.map((item) => item.seq)).toEqual([1])
    store.close()
  })

  it("连续全量清理递增 global generation 并使所有作用域旧写入失效", async () => {
    const store = await createStore()
    const otherScope = {
      ...scope,
      conversationId: "conversation-2",
      target: {
        id: "server-2",
        normalizedUrl: "https://other.example.com",
        userId: "user-2",
      },
    }
    const firstGeneration = store.getSyncState(scope).generation
    const otherGeneration = store.getSyncState(otherScope).generation
    store.upsert(scope, [record(1)], firstGeneration)
    store.upsert(
      otherScope,
      [{ ...record(2), conversationId: otherScope.conversationId }],
      otherGeneration,
    )

    store.clearAll()
    expect(store.readRecent(scope, 20).messages).toEqual([])
    expect(store.readRecent(otherScope, 20).messages).toEqual([])
    const secondGeneration = store.getSyncState(scope).generation
    expect(secondGeneration.global).toBe(1)
    store.clearAll()

    expect(store.getSyncState(scope).generation.global).toBe(2)
    expect(() => store.upsert(scope, [record(1)], firstGeneration)).toThrow("generation")
    expect(() =>
      store.upsert(
        otherScope,
        [{ ...record(2), conversationId: otherScope.conversationId }],
        otherGeneration,
      ),
    ).toThrow("generation")
    expect(() => store.upsert(scope, [record(3)], secondGeneration)).toThrow("generation")
    store.close()
  })

  it("global generation 跨数据库重启持久化", async () => {
    const { databasePath, store } = await createStoreWithPath()
    const staleGeneration = store.getSyncState(scope).generation
    store.clearAll()
    store.close()

    const reopened = new MessageCacheStore(databasePath)
    const currentGeneration = reopened.getSyncState(scope).generation
    expect(currentGeneration.global).toBe(1)
    expect(() => reopened.upsert(scope, [record(1)], staleGeneration)).toThrow("generation")
    reopened.upsert(scope, [record(1)], currentGeneration)
    expect(reopened.readRecent(scope, 20).messages).toHaveLength(1)
    reopened.close()
  })

  it("局部清理只递增对应作用域 generation，不改变 global generation", async () => {
    const store = await createStore()

    const afterConversation = store.clearConversation(scope)
    expect(afterConversation).toMatchObject({ conversation: 1, global: 0, server: 0, user: 0 })
    store.clearUser(scope.target)
    expect(store.getSyncState(scope).generation).toMatchObject({ global: 0, server: 0, user: 1 })
    store.clearServer(scope.target)
    expect(store.getSyncState(scope).generation).toMatchObject({ global: 0, server: 1, user: 1 })
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

  it("启动清扫只删除已经没有 Profile 的 Server 缓存", async () => {
    const store = await createStore()
    const orphanedScope = {
      ...scope,
      target: {
        id: "server-removed",
        normalizedUrl: "https://removed.example.com",
        userId: "user-2",
      },
    }
    store.upsert(scope, [record(1)], generation)
    store.upsert(orphanedScope, [record(2)], generation)

    store.clearOrphanedServers([scope.target])

    expect(store.readRecent(scope, 20).messages).toHaveLength(1)
    expect(store.readRecent(orphanedScope, 20).messages).toEqual([])
    store.close()
  })

  it("所有隐私清理路径都会删除无法归属的隔离文件", async () => {
    const { databasePath, store } = await createStoreWithPath()
    const clearOperations = [
      () => store.clearConversation(scope),
      () => store.clearUser(scope.target),
      () => store.clearServer(scope.target),
      () => store.clearOrphanedServers([scope.target]),
      () => store.clearAll(),
    ]

    for (const clear of clearOperations) {
      await createIsolatedFiles(databasePath)
      clear()
      expect(await isolatedFiles(databasePath)).toEqual([])
    }
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
    const page = store.readRecent(scope, 20)
    expect(page.messages.map((item) => item.seq)).toEqual([2])
    expect(page.complete).toBe(false)
    expect(store.getStats(scope.target).messageCount).toBe(1)
    store.close()
  })

  it.each([2, 3])("隔离第 %i 次重命名失败时回滚全部已移动文件", async (failureAt) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-message-cache-"))
    directories.push(directory)
    const databasePath = path.join(directory, "messages.sqlite3")
    await Promise.all(
      ["", "-wal", "-shm"].map((extension) => writeFile(`${databasePath}${extension}`, "cache")),
    )
    let renameCount = 0

    expect(() =>
      isolateDatabaseFiles(databasePath, (source, target) => {
        renameCount += 1
        if (renameCount === failureAt) throw new Error("rename failed")
        renameSync(source, target)
      }),
    ).toThrow("rename failed")

    expect((await readdir(directory)).sort()).toEqual(
      ["messages.sqlite3", "messages.sqlite3-shm", "messages.sqlite3-wal"].sort(),
    )
  })

  it("隔离时先移动 WAL 和 SHM，最后移动主数据库", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-message-cache-"))
    directories.push(directory)
    const databasePath = path.join(directory, "messages.sqlite3")
    await Promise.all(
      ["", "-wal", "-shm"].map((extension) => writeFile(`${databasePath}${extension}`, "cache")),
    )
    const movedSources: string[] = []

    isolateDatabaseFiles(databasePath, (source, target) => {
      movedSources.push(path.basename(source))
      renameSync(source, target)
    })

    expect(movedSources).toEqual([
      "messages.sqlite3-wal",
      "messages.sqlite3-shm",
      "messages.sqlite3",
    ])
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

  it("启动时只清扫合法隔离文件并保留相似文件和目录", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-message-cache-"))
    directories.push(directory)
    const databasePath = path.join(directory, "messages.sqlite3")
    await createIsolatedFiles(databasePath)
    await writeFile(`${databasePath}.isolated-invalid`, "keep")
    await writeFile(`${databasePath}.backup.isolated-123`, "keep")
    await mkdir(`${databasePath}.isolated-456`)

    const store = openMessageCacheStore(databasePath)
    store.close()

    const files = await readdir(directory)
    expect(files).toContain("messages.sqlite3.isolated-invalid")
    expect(files).toContain("messages.sqlite3.backup.isolated-123")
    expect(files).toContain("messages.sqlite3.isolated-456")
    expect(await isolatedFiles(databasePath)).toEqual([])
  })

  it("未知高版本 schema 临时让位并在新库成功后零保留", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-message-cache-"))
    directories.push(directory)
    const databasePath = path.join(directory, "messages.sqlite3")
    const database = new DatabaseSync(databasePath)
    database.exec("PRAGMA user_version = 99")
    database.close()

    const rebuilt = openMessageCacheStore(databasePath)
    expect(rebuilt.health().status).toBe("available")
    rebuilt.close()
    expect(await isolatedFiles(databasePath)).toEqual([])
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

async function createIsolatedFiles(databasePath: string): Promise<void> {
  await Promise.all(
    ["", "-wal", "-shm"].map((extension) =>
      writeFile(`${databasePath}${extension}.isolated-123`, "isolated"),
    ),
  )
}

async function isolatedFiles(databasePath: string): Promise<string[]> {
  const basename = path.basename(databasePath)
  return (await readdir(path.dirname(databasePath), { withFileTypes: true }))
    .filter(
      (entry) =>
        (entry.isFile() || entry.isSymbolicLink()) &&
        new RegExp(`^${basename}(?:-wal|-shm)?\\.isolated-\\d+$`).test(entry.name),
    )
    .map((entry) => entry.name)
}
