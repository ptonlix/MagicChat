import type { DatabaseSync } from "node:sqlite"
import {
  MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION,
  MESSAGE_CACHE_SCHEMA_VERSION,
} from "@shared/message-cache-contract"
import { MESSAGE_CACHE_INITIAL_SCHEMA } from "./message-cache-schema"

export function migrateMessageCache(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA user_version").get() as
    | Readonly<{ user_version: number }>
    | undefined
  const previousVersion = row?.user_version ?? 0
  if (previousVersion > MESSAGE_CACHE_SCHEMA_VERSION) {
    throw new Error("cache schema is newer than this application")
  }
  database.exec("BEGIN EXCLUSIVE")
  try {
    database.exec(MESSAGE_CACHE_INITIAL_SCHEMA)
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
    database.exec(`PRAGMA user_version = ${MESSAGE_CACHE_SCHEMA_VERSION}`)
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}
