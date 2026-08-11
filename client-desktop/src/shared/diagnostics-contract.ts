export const DIAGNOSTIC_SCHEMA_VERSION = 4 as const

export const DIAGNOSTIC_ORIGINS = ["main", "renderer", "gpu"] as const
export type DiagnosticOrigin = (typeof DIAGNOSTIC_ORIGINS)[number]

export const DIAGNOSTIC_TYPES = [
  "realtime.connection-created",
  "realtime.socket-opened",
  "realtime.socket-closed",
  "realtime.reconnect-scheduled",
  "realtime.authorization-checked",
  "realtime.system-ready",
  "realtime.state-changed",
  "realtime.event-parse-failed",
  "realtime.parse-failures-aggregated",
  "realtime-bridge.snapshot-sent",
  "realtime-bridge.snapshot-received",
  "realtime-bridge.snapshot-missed",
  "realtime-bridge.delivery-failed",
  "conversation-list.completed",
  "conversation-list.failed",
  "conversation-list.seq-diverged",
  "message-sync.candidate",
  "message-sync.started",
  "message-sync.page-requested",
  "message-sync.page-received",
  "message-sync.cache-committed",
  "message-sync.completed",
  "message-sync.failed",
  "message-sync.cancelled",
  "message-sync.skipped",
  "message-cache.state-changed",
  "conversation-ui.view-changed",
  "conversation-ui.state-observed",
  "environment.lifecycle-changed",
  "environment.window-state-changed",
  "environment.network-changed",
  "runtime.stall-observed",
  "gpu.process-error",
] as const
export type DiagnosticType = (typeof DIAGNOSTIC_TYPES)[number]

export type DiagnosticContext = Readonly<{
  connectionInstanceId?: string
  conversationId?: string
  episodeId?: string
  listRefreshId?: string
  requestId?: string
  syncOperationId?: string
  targetScope?: string
}>

type DiagnosticPrimitive = boolean | number | string
export type DiagnosticData = Readonly<{
  [key: string]: DiagnosticPrimitive | Readonly<Record<string, DiagnosticPrimitive>>
}>

export type DiagnosticEventInput = Readonly<{
  context?: DiagnosticContext
  data?: DiagnosticData
  origin: DiagnosticOrigin
  type: DiagnosticType
}>

export type DiagnosticEvent = DiagnosticEventInput &
  Readonly<{
    eventSeq: number
    timestamp: string
  }>

export type DiagnosticStorageStats = Readonly<{
  bytes: number
  status: "available" | "unavailable"
}>

const identifierPattern = /^[a-zA-Z0-9_-]{1,128}$/
const identifierFields = [
  "episodeId",
  "targetScope",
  "connectionInstanceId",
  "conversationId",
  "listRefreshId",
  "syncOperationId",
  "requestId",
] as const
const dataKeys = new Set([
  "activeRefreshes",
  "activeRequests",
  "appActivatedAgeMs",
  "attempt",
  "afterSeq",
  "cacheNewestSeq",
  "closeCode",
  "closeReasonLength",
  "committedSeq",
  "documentVisibility",
  "durationMs",
  "deliveryFailureCount",
  "deliverySucceededCount",
  "eventLoopLagMs",
  "firstReturnedSeq",
  "hasMoreAfter",
  "hasMoreBefore",
  "httpSyncedThroughSeq",
  "initialCursor",
  "lastMessageSeq",
  "latestKnownSeq",
  "loaded",
  "longTaskCount",
  "longTaskMaxDurationMs",
  "memoryCursor",
  "memoryMb",
  "navigatorOnline",
  "pageCount",
  "pageNewestSeq",
  "pendingLatestMessageCount",
  "pendingRequestCount",
  "displayedNewestSeq",
  "previousReady",
  "previousStatus",
  "ready",
  "reason",
  "reconnectAttempt",
  "responseStatus",
  "returnedCount",
  "returnedLastSeq",
  "seqDelta",
  "status",
  "suppressedCount",
  "suppressedFromEventSeq",
  "suppressedToEventSeq",
  "systemReadyCount",
  "trigger",
  "viewMode",
  "windowEndedAt",
  "windowFocused",
  "windowMinimized",
  "windowStartedAt",
  "windowVisible",
  "endpoint",
  "error",
])
const stringValues = new Set([
  "authorization",
  "cache",
  "cancelled",
  "closed",
  "connection",
  "concurrent",
  "connected",
  "connecting",
  "conversation-list",
  "disconnected",
  "hidden",
  "history",
  "http",
  "list",
  "list-divergence",
  "loaded-conversation",
  "latest",
  "lifecycle",
  "locked",
  "manual",
  "message-after-seq",
  "network",
  "offline",
  "online",
  "parse",
  "request",
  "reconnect",
  "reconnecting",
  "ready-edge",
  "resume",
  "stale",
  "suspend",
  "unknown",
  "unmounted",
  "visible",
  "window",
])
const errorKeys = new Set(["category", "phase", "status"])

export function parseDiagnosticEventInput(
  value: unknown,
  allowedOrigins: ReadonlySet<DiagnosticOrigin> = new Set(DIAGNOSTIC_ORIGINS),
): DiagnosticEventInput {
  const input = objectValue(value)
  if (!isDiagnosticOrigin(input.origin) || !allowedOrigins.has(input.origin)) invalid()
  if (!isDiagnosticType(input.type)) invalid()
  const context = input.context === undefined ? undefined : parseDiagnosticContext(input.context)
  const data = input.data === undefined ? undefined : parseDiagnosticData(input.data)
  return {
    ...(context ? { context } : {}),
    ...(data ? { data } : {}),
    origin: input.origin,
    type: input.type,
  }
}

export function parseDiagnosticEvent(value: unknown): DiagnosticEvent {
  const input = objectValue(value)
  const event = parseDiagnosticEventInput(input)
  const eventSeq = input.eventSeq
  if (
    typeof eventSeq !== "number" ||
    !Number.isSafeInteger(eventSeq) ||
    eventSeq < 1 ||
    eventSeq > Number.MAX_SAFE_INTEGER
  )
    invalid()
  if (typeof input.timestamp !== "string" || !Number.isFinite(Date.parse(input.timestamp)))
    invalid()
  return { ...event, eventSeq, timestamp: input.timestamp }
}

export function isDiagnosticType(value: unknown): value is DiagnosticType {
  return typeof value === "string" && (DIAGNOSTIC_TYPES as readonly string[]).includes(value)
}

export function isDiagnosticOrigin(value: unknown): value is DiagnosticOrigin {
  return typeof value === "string" && (DIAGNOSTIC_ORIGINS as readonly string[]).includes(value)
}

export function parseDiagnosticContext(value: unknown): DiagnosticContext {
  const input = objectValue(value)
  const entries = identifierFields.flatMap((field) => {
    const candidate = input[field]
    if (candidate === undefined) return []
    if (typeof candidate !== "string" || !identifierPattern.test(candidate)) invalid()
    return [[field, candidate] as const]
  })
  if (entries.length === 0 || Object.keys(input).length !== entries.length) invalid()
  return Object.freeze(Object.fromEntries(entries))
}

export function parseDiagnosticData(value: unknown): DiagnosticData {
  const input = objectValue(value)
  const entries = Object.entries(input)
  if (entries.length > 32) invalid()
  for (const [key, candidate] of entries) {
    if (!dataKeys.has(key) || !isDiagnosticDataValue(key, candidate)) invalid()
  }
  return Object.freeze({ ...input }) as DiagnosticData
}

function isDiagnosticDataValue(key: string, value: unknown): boolean {
  if (key === "error") return isErrorData(value)
  if (key === "windowStartedAt" || key === "windowEndedAt")
    return typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value))
  if (typeof value === "boolean") return true
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 && value <= 1_000_000_000
  return typeof value === "string" && stringValues.has(value)
}

function isErrorData(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const entries = Object.entries(input)
  return (
    entries.length >= 1 &&
    entries.length <= 3 &&
    entries.every(
      ([key, candidate]) =>
        errorKeys.has(key) &&
        ((key === "status" &&
          typeof candidate === "number" &&
          Number.isSafeInteger(candidate) &&
          candidate >= 0 &&
          candidate <= 999) ||
          (key !== "status" && typeof candidate === "string" && stringValues.has(candidate))),
    )
  )
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function invalid(): never {
  throw new Error("诊断事件字段无效")
}
