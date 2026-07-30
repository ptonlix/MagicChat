// @vitest-environment node
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { MESSAGE_CACHE_SCHEMA_VERSION } from "@shared/message-cache-contract"
import {
  MESSAGE_CACHE_MIGRATIONS,
  migrateMessageCache,
  type MessageCacheMigration,
  validateMessageCacheMigrations,
} from "./message-cache-migrations"

describe("消息缓存数据库迁移", () => {
  it("空数据库从 0 逐级执行到当前版本并完成建库", () => {
    withDatabase((database) => {
      migrateMessageCache(database)

      expect(userVersion(database)).toBe(MESSAGE_CACHE_SCHEMA_VERSION)
      expect(MESSAGE_CACHE_MIGRATIONS.map(({ version }) => version)).toEqual([1, 2])
      expect(tableNames(database)).toEqual(
        expect.arrayContaining([
          "cached_messages",
          "message_cache_generations",
          "message_cache_metadata",
          "message_cache_stats",
          "message_sync_state",
        ]),
      )
    })
  })

  it("数据库已经是目标版本时不重复执行迁移", () => {
    withDatabase((database) => {
      migrateMessageCache(database)
      const migrations: ReadonlyArray<MessageCacheMigration> = [
        {
          migrate: () => {
            throw new Error("版本 1 不应重复执行")
          },
          version: 1,
        },
        {
          migrate: () => {
            throw new Error("版本 2 不应重复执行")
          },
          version: 2,
        },
      ]

      expect(() => migrateMessageCache(database, { migrations, supportedVersion: 2 })).not.toThrow()
      expect(userVersion(database)).toBe(2)
    })
  })

  it("真实 v1 数据库升级到 v2 时补建 generation 表并保留已有数据", () => {
    withDatabase((database) => {
      migrateMessageCache(database, {
        migrations: MESSAGE_CACHE_MIGRATIONS.slice(0, 1),
        supportedVersion: 1,
      })
      database
        .prepare("INSERT INTO message_cache_metadata (key, value) VALUES ('migration_probe', 7)")
        .run()
      expect(tableNames(database)).not.toContain("message_cache_generations")

      migrateMessageCache(database)

      expect(userVersion(database)).toBe(2)
      expect(tableNames(database)).toContain("message_cache_generations")
      expect(
        database
          .prepare("SELECT value FROM message_cache_metadata WHERE key = 'migration_probe'")
          .get(),
      ).toEqual({ value: 7 })
    })
  })

  it("从当前版本依次执行后续迁移并逐级更新版本", () => {
    withDatabase((database) => {
      migrateMessageCache(database)
      const applied: number[] = []
      const migrations: ReadonlyArray<MessageCacheMigration> = [
        { migrate: () => applied.push(1), version: 1 },
        { migrate: () => applied.push(2), version: 2 },
        {
          migrate: (target) => {
            applied.push(3)
            target.exec("CREATE TABLE migration_probe (value INTEGER NOT NULL)")
          },
          version: 3,
        },
        {
          migrate: (target) => {
            applied.push(4)
            target.exec("ALTER TABLE migration_probe ADD COLUMN label TEXT")
          },
          version: 4,
        },
      ]

      migrateMessageCache(database, { migrations, supportedVersion: 4 })

      expect(applied).toEqual([3, 4])
      expect(userVersion(database)).toBe(4)
      expect(
        database
          .prepare("PRAGMA table_info(migration_probe)")
          .all()
          .map((row) => row.name),
      ).toEqual(["value", "label"])
    })
  })

  it("后续迁移失败时同时回滚结构和 user_version", () => {
    withDatabase((database) => {
      migrateMessageCache(database)
      const migrations: ReadonlyArray<MessageCacheMigration> = [
        { migrate: () => undefined, version: 1 },
        { migrate: () => undefined, version: 2 },
        {
          migrate: (target) => {
            target.exec("CREATE TABLE migration_probe (value INTEGER NOT NULL)")
            throw new Error("migration failed")
          },
          version: 3,
        },
      ]

      expect(() => migrateMessageCache(database, { migrations, supportedVersion: 3 })).toThrow(
        "migration failed",
      )
      expect(userVersion(database)).toBe(2)
      expect(tableNames(database)).not.toContain("migration_probe")
    })
  })

  it.each([
    ["重复", [migration(1), migration(1)], 2],
    ["缺失", [migration(1), migration(3)], 3],
    ["乱序", [migration(2), migration(1)], 2],
    ["未登记目标版本", [migration(1)], 2],
  ])("拒绝%s的迁移版本注册表", (_name, migrations, supportedVersion) => {
    expect(() => validateMessageCacheMigrations(migrations, supportedVersion)).toThrow(
      "cache migration registry is invalid",
    )
  })
})

function migration(version: number): MessageCacheMigration {
  return { migrate: () => undefined, version }
}

function tableNames(database: DatabaseSync): string[] {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
}

function userVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as
    | Readonly<{ user_version: number }>
    | undefined
  return row?.user_version ?? 0
}

function withDatabase(operation: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(":memory:")
  try {
    operation(database)
  } finally {
    database.close()
  }
}
