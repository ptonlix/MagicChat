import type { DatabaseSync } from "node:sqlite"
import {
  MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION,
  MESSAGE_CACHE_SCHEMA_VERSION,
} from "@shared/message-cache-contract"
import { MESSAGE_CACHE_SCHEMA_V1, MESSAGE_CACHE_SCHEMA_V2 } from "./message-cache-schema"

export type MessageCacheMigration = Readonly<{
  migrate(database: DatabaseSync): void
  version: number
}>

export const MESSAGE_CACHE_MIGRATIONS: ReadonlyArray<MessageCacheMigration> = [
  { migrate: (database) => database.exec(MESSAGE_CACHE_SCHEMA_V1), version: 1 },
  { migrate: (database) => database.exec(MESSAGE_CACHE_SCHEMA_V2), version: 2 },
]

type MessageCacheMigrationOptions = Readonly<{
  migrations?: ReadonlyArray<MessageCacheMigration>
  supportedVersion?: number
}>

export function migrateMessageCache(
  database: DatabaseSync,
  options: MessageCacheMigrationOptions = {},
): void {
  const migrations = options.migrations ?? MESSAGE_CACHE_MIGRATIONS
  const supportedVersion = options.supportedVersion ?? MESSAGE_CACHE_SCHEMA_VERSION
  validateMessageCacheMigrations(migrations, supportedVersion)
  const row = database.prepare("PRAGMA user_version").get() as
    | Readonly<{ user_version: number }>
    | undefined
  const previousVersion = row?.user_version ?? 0
  if (previousVersion > supportedVersion) {
    throw new Error("cache schema is newer than this application")
  }
  database.exec("BEGIN EXCLUSIVE")
  try {
    for (const migration of migrations) {
      if (migration.version <= previousVersion) continue
      migration.migrate(database)
      database.exec(`PRAGMA user_version = ${migration.version}`)
    }
    const payloadRow = database
      .prepare("SELECT value FROM message_cache_metadata WHERE key = 'payload_schema_version'")
      .get() as Readonly<{ value: number }> | undefined
    if (payloadRow && payloadRow.value !== MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION) {
      database.exec(`
        DELETE FROM cached_messages;
        DELETE FROM message_sync_state;
        DELETE FROM message_cache_stats;
      `)
    }
    database
      .prepare(
        `INSERT INTO message_cache_metadata (key, value)
         VALUES ('payload_schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION)
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}

export function validateMessageCacheMigrations(
  migrations: ReadonlyArray<MessageCacheMigration>,
  supportedVersion: number,
): void {
  if (!Number.isSafeInteger(supportedVersion) || supportedVersion < 1) invalidMigrationRegistry()
  if (migrations.length !== supportedVersion) invalidMigrationRegistry()
  for (let index = 0; index < migrations.length; index += 1) {
    if (migrations[index]?.version !== index + 1) invalidMigrationRegistry()
  }
}

function invalidMigrationRegistry(): never {
  throw new Error("cache migration registry is invalid")
}
