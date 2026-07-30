import { normalizeServerUrl, type AuthenticatedTarget } from "@shared/client-contract"
import {
  MESSAGE_CACHE_LIMITS,
  MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION,
  MessageCacheError,
  type MessageCacheCommit,
  type MessageCacheGeneration,
  type MessageCacheRecord,
  type MessageCacheScope,
} from "@shared/message-cache-contract"

export function parseMessageCacheScope(value: unknown): MessageCacheScope {
  if (!isObject(value)) invalid()
  return {
    conversationId: parseId(value.conversationId),
    target: parseTarget(value.target),
  }
}

export function parseMessageCacheTarget(value: unknown): AuthenticatedTarget {
  return parseTarget(value)
}

export function parseMessageCacheServerTarget(
  value: unknown,
): Pick<AuthenticatedTarget, "id" | "normalizedUrl"> {
  if (!isObject(value)) invalid()
  return {
    id: parseId(value.id),
    normalizedUrl: parseUrl(value.normalizedUrl),
  }
}

export function parseMessageCacheLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100) invalid()
  return Number(value)
}

export function parseMessageCacheSeq(value: unknown, allowZero = false): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < (allowZero ? 0 : 1) ||
    Number(value) > MESSAGE_CACHE_LIMITS.maxSeq
  )
    invalid()
  return Number(value)
}

export function parseMessageCacheId(value: unknown): string {
  return parseId(value)
}

export function parseMessageCacheGeneration(value: unknown): MessageCacheGeneration {
  if (!isObject(value)) invalid()
  return {
    conversation: parseGenerationValue(value.conversation),
    global: parseGenerationValue(value.global),
    server: parseGenerationValue(value.server),
    user: parseGenerationValue(value.user),
  }
}

export function parseMessageCacheRecords(
  value: unknown,
  scope: MessageCacheScope,
): ReadonlyArray<MessageCacheRecord> {
  if (!Array.isArray(value) || value.length > MESSAGE_CACHE_LIMITS.maxBatchRecords) invalid()
  let totalBytes = 0
  const ids = new Set<string>()
  const seqs = new Set<number>()
  const records = value.map((entry) => {
    if (!isObject(entry)) invalid()
    const payloadJson = parsePayload(entry.payloadJson)
    const record: MessageCacheRecord = {
      cachedAt: parseTimestamp(entry.cachedAt),
      conversationId: parseId(entry.conversationId),
      createdAt: parseCreatedAt(entry.createdAt),
      messageId: parseId(entry.messageId),
      payloadJson,
      payloadSchemaVersion: parseMessageCacheSeq(entry.payloadSchemaVersion),
      reactionVersion: parseMessageCacheSeq(entry.reactionVersion, true),
      seq: parseMessageCacheSeq(entry.seq),
    }
    if (
      record.conversationId !== scope.conversationId ||
      record.payloadSchemaVersion !== MESSAGE_CACHE_PAYLOAD_SCHEMA_VERSION ||
      ids.has(record.messageId) ||
      seqs.has(record.seq)
    )
      invalid()
    ids.add(record.messageId)
    seqs.add(record.seq)
    totalBytes += Buffer.byteLength(payloadJson)
    return record
  })
  if (totalBytes > MESSAGE_CACHE_LIMITS.maxBatchBytes) invalid()
  return records
}

export function parseMessageCacheCommit(
  value: unknown,
  scope: MessageCacheScope,
): MessageCacheCommit {
  if (!isObject(value)) invalid()
  return {
    generation: parseMessageCacheGeneration(value.generation),
    hasMoreBefore: parseBoolean(value.hasMoreBefore),
    records: parseMessageCacheRecords(value.records, scope),
    requestAfterSeq:
      value.requestAfterSeq === undefined
        ? undefined
        : parseMessageCacheSeq(value.requestAfterSeq, true),
    requestBeforeSeq:
      value.requestBeforeSeq === undefined
        ? undefined
        : parseMessageCacheSeq(value.requestBeforeSeq),
  }
}

function parseTarget(value: unknown): AuthenticatedTarget {
  if (!isObject(value)) invalid()
  return {
    id: parseId(value.id),
    normalizedUrl: parseUrl(value.normalizedUrl),
    userId: parseId(value.userId),
  }
}

function parseId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MESSAGE_CACHE_LIMITS.idLength ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  )
    invalid()
  return value
}

function parsePayload(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > MESSAGE_CACHE_LIMITS.maxPayloadBytes
  )
    invalid()
  try {
    JSON.parse(value)
  } catch {
    invalid()
  }
  return value
}

function parseUrl(value: unknown): string {
  if (typeof value !== "string") invalid()
  const normalized = normalizeServerUrl(value, !process.env.MAGICCHAT_RELEASE_CHANNEL)
  if (normalized !== value) invalid()
  return normalized
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid()
  return value
}

function parseGenerationValue(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid()
  return Number(value)
}

function parseTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid()
  return Number(value)
}

function parseCreatedAt(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) invalid()
  if (!Number.isFinite(Date.parse(value))) invalid()
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function invalid(): never {
  throw new MessageCacheError("cache_invalid_input", "本地消息缓存请求无效")
}
