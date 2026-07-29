import type { ClientMessage } from "@/lib/client-data-api"
import {
  MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION,
  type MessageCacheRecord,
} from "@shared/message-cache-contract"

export function serializeMessage(message: ClientMessage): MessageCacheRecord {
  return {
    cachedAt: Date.now(),
    conversationId: message.conversationId,
    createdAt: message.createdAt,
    messageId: message.id,
    payloadJson: JSON.stringify(message),
    payloadSchemaVersion: MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION,
    reactionVersion: message.reactionVersion ?? 0,
    seq: message.seq,
  }
}

export function deserializeMessage(record: MessageCacheRecord): ClientMessage | null {
  if (record.payloadSchemaVersion !== MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION) return null
  let value: unknown
  try {
    value = JSON.parse(record.payloadJson)
  } catch {
    return null
  }
  if (!isObject(value) || !isObject(value.body) || !isObject(value.sender)) return null
  if (
    value.id !== record.messageId ||
    value.conversationId !== record.conversationId ||
    value.seq !== record.seq ||
    typeof value.createdAt !== "string" ||
    typeof value.body.type !== "string" ||
    typeof value.sender.type !== "string"
  )
    return null
  return value as ClientMessage
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
