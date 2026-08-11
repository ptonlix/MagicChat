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

export type RealtimeDiagnosticContext = Readonly<
  Required<Pick<DiagnosticContext, "connectionInstanceId" | "episodeId" | "targetScope">>
>

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

const diagnosticErrorCategories = [
  "cache",
  "concurrent",
  "http",
  "network",
  "parse",
  "stale",
  "unknown",
  "unmounted",
] as const
type DiagnosticErrorCategory = (typeof diagnosticErrorCategories)[number]

const diagnosticErrorPhases = ["authorization", "cache", "list", "request"] as const
type DiagnosticErrorPhase = (typeof diagnosticErrorPhases)[number]

type DiagnosticErrorData =
  | Readonly<{
      category: DiagnosticErrorCategory
      phase?: DiagnosticErrorPhase
      status?: number
    }>
  | Readonly<{
      category?: DiagnosticErrorCategory
      phase: DiagnosticErrorPhase
      status?: number
    }>
  | Readonly<{
      category?: DiagnosticErrorCategory
      phase?: DiagnosticErrorPhase
      status: number
    }>

type DiagnosticDataFieldDefinition =
  | Readonly<{ kind: "boolean" }>
  | Readonly<{ kind: "error" }>
  | Readonly<{ kind: "number"; maximum: number }>
  | Readonly<{ kind: "timestamp" }>
  | Readonly<{ kind: "enum"; values: readonly string[] }>

// 诊断字段定义同时驱动生产端类型和跨进程、落盘数据的运行时校验。
const diagnosticDataFields = {
  activeRefreshes: { kind: "number", maximum: 1_000_000_000 },
  activeRequests: { kind: "number", maximum: 1_000_000_000 },
  appActivatedAgeMs: { kind: "number", maximum: 1_000_000_000 },
  attempt: { kind: "number", maximum: 1_000_000_000 },
  afterSeq: { kind: "number", maximum: 1_000_000_000 },
  cacheNewestSeq: { kind: "number", maximum: 1_000_000_000 },
  closeCode: { kind: "number", maximum: 9_999 },
  closeReasonLength: { kind: "number", maximum: 256 },
  committedSeq: { kind: "number", maximum: 1_000_000_000 },
  deliveryFailureCount: { kind: "number", maximum: 1_000_000_000 },
  deliverySucceededCount: { kind: "number", maximum: 1_000_000_000 },
  displayedNewestSeq: { kind: "number", maximum: 1_000_000_000 },
  documentVisibility: { kind: "enum", values: ["hidden", "visible"] },
  durationMs: { kind: "number", maximum: 1_000_000_000 },
  endpoint: { kind: "enum", values: ["conversation-list", "message-after-seq"] },
  error: { kind: "error" },
  eventLoopLagMs: { kind: "number", maximum: 1_000_000_000 },
  firstReturnedSeq: { kind: "number", maximum: 1_000_000_000 },
  hasMoreAfter: { kind: "boolean" },
  hasMoreBefore: { kind: "boolean" },
  httpSyncedThroughSeq: { kind: "number", maximum: 1_000_000_000 },
  initialCursor: { kind: "number", maximum: 1_000_000_000 },
  lastMessageSeq: { kind: "number", maximum: 1_000_000_000 },
  latestKnownSeq: { kind: "number", maximum: 1_000_000_000 },
  loaded: { kind: "boolean" },
  longTaskCount: { kind: "number", maximum: 1_000_000_000 },
  longTaskMaxDurationMs: { kind: "number", maximum: 1_000_000_000 },
  memoryCursor: { kind: "number", maximum: 1_000_000_000 },
  memoryMb: { kind: "number", maximum: 1_000_000_000 },
  navigatorOnline: { kind: "boolean" },
  pageCount: { kind: "number", maximum: 1_000_000_000 },
  pageNewestSeq: { kind: "number", maximum: 1_000_000_000 },
  pendingLatestMessageCount: { kind: "number", maximum: 1_000_000_000 },
  pendingRequestCount: { kind: "number", maximum: 1_000_000_000 },
  previousReady: { kind: "boolean" },
  previousStatus: {
    kind: "enum",
    values: ["connected", "connecting", "disconnected", "reconnecting"],
  },
  reason: {
    kind: "enum",
    values: [
      "authorization",
      "cancelled",
      "connection",
      "concurrent",
      "lifecycle",
      "locked",
      "manual",
      "network",
      "parse",
      "reconnect",
      "resume",
      "stale",
      "suspend",
      "unknown",
      "unmounted",
      "window",
    ],
  },
  ready: { kind: "boolean" },
  reconnectAttempt: { kind: "number", maximum: 1_000_000_000 },
  responseStatus: { kind: "number", maximum: 999 },
  returnedCount: { kind: "number", maximum: 1_000_000_000 },
  returnedLastSeq: { kind: "number", maximum: 1_000_000_000 },
  seqDelta: { kind: "number", maximum: 1_000_000_000 },
  status: { kind: "enum", values: ["connected", "connecting", "disconnected", "reconnecting"] },
  suppressedCount: { kind: "number", maximum: 1_000_000_000 },
  suppressedFromEventSeq: { kind: "number", maximum: 1_000_000_000 },
  suppressedToEventSeq: { kind: "number", maximum: 1_000_000_000 },
  systemReadyCount: { kind: "number", maximum: 1_000_000_000 },
  trigger: { kind: "enum", values: ["list-divergence", "loaded-conversation", "ready-edge"] },
  viewMode: { kind: "enum", values: ["history", "latest"] },
  windowEndedAt: { kind: "timestamp" },
  windowFocused: { kind: "boolean" },
  windowMinimized: { kind: "boolean" },
  windowStartedAt: { kind: "timestamp" },
  windowVisible: { kind: "boolean" },
} as const satisfies Record<string, DiagnosticDataFieldDefinition>

type DiagnosticDataKey = keyof typeof diagnosticDataFields
type DiagnosticDataFieldValue<Field extends DiagnosticDataFieldDefinition> =
  Field extends Readonly<{ kind: "boolean" }>
    ? boolean
    : Field extends Readonly<{ kind: "error" }>
      ? DiagnosticErrorData
      : Field extends Readonly<{ kind: "number" }>
        ? number
        : Field extends Readonly<{ kind: "timestamp" }>
          ? string
          : Field extends Readonly<{
                kind: "enum"
                values: readonly (infer Value extends string)[]
              }>
            ? Value
            : never

type DiagnosticDataValue<Key extends DiagnosticDataKey> = DiagnosticDataFieldValue<
  (typeof diagnosticDataFields)[Key]
>

const diagnosticDataValueOverridesByType = {
  "conversation-list.completed": { endpoint: ["conversation-list"] },
  "conversation-list.failed": { endpoint: ["conversation-list"] },
  "message-sync.page-received": { endpoint: ["message-after-seq"] },
  "message-sync.page-requested": { endpoint: ["message-after-seq"] },
} as const satisfies Partial<
  Record<DiagnosticType, Partial<Record<DiagnosticDataKey, readonly string[]>>>
>

type DiagnosticDataValueForType<
  Type extends DiagnosticType,
  Key extends DiagnosticDataKey,
> = Type extends keyof typeof diagnosticDataValueOverridesByType
  ? Key extends keyof (typeof diagnosticDataValueOverridesByType)[Type]
    ? (typeof diagnosticDataValueOverridesByType)[Type][Key] extends readonly string[]
      ? (typeof diagnosticDataValueOverridesByType)[Type][Key][number]
      : DiagnosticDataValue<Key>
    : DiagnosticDataValue<Key>
  : DiagnosticDataValue<Key>

export type DiagnosticData = Readonly<{
  [Key in DiagnosticDataKey]?: DiagnosticDataValue<Key>
}>

const diagnosticDataKeysByType = {
  "conversation-list.completed": ["durationMs", "endpoint", "responseStatus", "returnedCount"],
  "conversation-list.failed": ["durationMs", "endpoint", "error"],
  "conversation-list.seq-diverged": ["httpSyncedThroughSeq", "lastMessageSeq", "seqDelta"],
  "conversation-ui.state-observed": [
    "displayedNewestSeq",
    "latestKnownSeq",
    "loaded",
    "pageNewestSeq",
    "pendingLatestMessageCount",
    "viewMode",
  ],
  "conversation-ui.view-changed": ["viewMode"],
  "environment.lifecycle-changed": [
    "durationMs",
    "eventLoopLagMs",
    "longTaskCount",
    "longTaskMaxDurationMs",
    "reason",
  ],
  "environment.network-changed": ["navigatorOnline"],
  "environment.window-state-changed": [
    "documentVisibility",
    "windowFocused",
    "windowMinimized",
    "windowVisible",
  ],
  "gpu.process-error": [
    "durationMs",
    "eventLoopLagMs",
    "longTaskCount",
    "longTaskMaxDurationMs",
    "reason",
  ],
  "message-cache.state-changed": [
    "afterSeq",
    "cacheNewestSeq",
    "committedSeq",
    "error",
    "httpSyncedThroughSeq",
    "memoryCursor",
  ],
  "message-sync.cache-committed": ["afterSeq", "cacheNewestSeq", "committedSeq", "memoryCursor"],
  "message-sync.cancelled": ["error"],
  "message-sync.candidate": ["afterSeq", "trigger"],
  "message-sync.completed": ["committedSeq", "pageCount", "pageNewestSeq"],
  "message-sync.failed": ["error"],
  "message-sync.page-received": [
    "afterSeq",
    "durationMs",
    "endpoint",
    "firstReturnedSeq",
    "responseStatus",
    "returnedCount",
    "returnedLastSeq",
  ],
  "message-sync.page-requested": ["afterSeq", "endpoint"],
  "message-sync.skipped": ["afterSeq", "reason"],
  "message-sync.started": ["afterSeq", "initialCursor", "trigger"],
  "realtime-bridge.delivery-failed": ["deliveryFailureCount"],
  "realtime-bridge.snapshot-missed": ["reason"],
  "realtime-bridge.snapshot-received": ["ready", "status"],
  "realtime-bridge.snapshot-sent": ["deliverySucceededCount"],
  "realtime.authorization-checked": ["error", "responseStatus"],
  "realtime.connection-created": ["ready", "status"],
  "realtime.event-parse-failed": ["error"],
  "realtime.parse-failures-aggregated": [
    "suppressedCount",
    "suppressedFromEventSeq",
    "suppressedToEventSeq",
    "windowEndedAt",
    "windowStartedAt",
  ],
  "realtime.reconnect-scheduled": ["attempt", "durationMs"],
  "realtime.socket-closed": [
    "closeCode",
    "closeReasonLength",
    "previousReady",
    "previousStatus",
    "reason",
    "ready",
    "status",
  ],
  "realtime.socket-opened": ["previousStatus", "ready", "status"],
  "realtime.state-changed": [
    "attempt",
    "pendingRequestCount",
    "previousReady",
    "previousStatus",
    "ready",
    "reason",
    "status",
  ],
  "realtime.system-ready": ["previousReady", "ready", "status", "systemReadyCount"],
  "runtime.stall-observed": [
    "appActivatedAgeMs",
    "documentVisibility",
    "durationMs",
    "eventLoopLagMs",
    "longTaskCount",
    "longTaskMaxDurationMs",
    "memoryMb",
    "navigatorOnline",
    "reason",
    "windowFocused",
    "windowMinimized",
    "windowVisible",
  ],
} as const satisfies Record<DiagnosticType, readonly DiagnosticDataKey[]>

const diagnosticRequiredContextKeysByType = {
  "message-sync.cache-committed": ["conversationId", "requestId", "syncOperationId"],
  "message-sync.page-received": ["conversationId", "requestId", "syncOperationId"],
  "message-sync.page-requested": ["conversationId", "requestId", "syncOperationId"],
  "realtime.state-changed": ["connectionInstanceId", "episodeId", "targetScope"],
} as const satisfies Partial<Record<DiagnosticType, readonly (typeof identifierFields)[number][]>>

const diagnosticRequiredDataKeysByType = {
  "message-sync.cache-committed": ["afterSeq", "cacheNewestSeq", "committedSeq", "memoryCursor"],
  "message-sync.page-received": [
    "afterSeq",
    "durationMs",
    "endpoint",
    "firstReturnedSeq",
    "responseStatus",
    "returnedCount",
    "returnedLastSeq",
  ],
  "message-sync.page-requested": ["afterSeq", "endpoint"],
  "realtime.state-changed": ["ready", "status"],
} as const satisfies Partial<Record<DiagnosticType, readonly DiagnosticDataKey[]>>

type RequiredDiagnosticContextKey<Type extends DiagnosticType> =
  Type extends keyof typeof diagnosticRequiredContextKeysByType
    ? (typeof diagnosticRequiredContextKeysByType)[Type][number]
    : never

type RequiredDiagnosticDataKey<Type extends DiagnosticType> =
  Type extends keyof typeof diagnosticRequiredDataKeysByType
    ? (typeof diagnosticRequiredDataKeysByType)[Type][number]
    : never

type DiagnosticContextForType<Type extends DiagnosticType> = Readonly<
  DiagnosticContext & Required<Pick<DiagnosticContext, RequiredDiagnosticContextKey<Type>>>
>

export type DiagnosticDataForType<Type extends DiagnosticType> = Type extends DiagnosticType
  ? Readonly<
      {
        [Key in RequiredDiagnosticDataKey<Type>]: DiagnosticDataValueForType<Type, Key>
      } & {
        [Key in Exclude<
          (typeof diagnosticDataKeysByType)[Type][number],
          RequiredDiagnosticDataKey<Type>
        >]?: DiagnosticDataValueForType<Type, Key>
      }
    >
  : never

export type DiagnosticEventInput<Type extends DiagnosticType = DiagnosticType> =
  Type extends DiagnosticType
    ? Readonly<
        {
          origin: DiagnosticOrigin
          type: Type
        } & (RequiredDiagnosticContextKey<Type> extends never
          ? { context?: DiagnosticContextForType<Type> }
          : { context: DiagnosticContextForType<Type> }) &
          (RequiredDiagnosticDataKey<Type> extends never
            ? { data?: DiagnosticDataForType<Type> }
            : { data: DiagnosticDataForType<Type> })
      >
    : never

export type DiagnosticEvent = Readonly<{
  context?: DiagnosticContext
  data?: DiagnosticData
  eventSeq: number
  origin: DiagnosticOrigin
  timestamp: string
  type: DiagnosticType
}>

export function createDiagnosticEventInput<Type extends DiagnosticType>(
  type: Type,
  origin: DiagnosticOrigin,
  context?: DiagnosticContext,
  data?: DiagnosticData,
): DiagnosticEventInput<Type> {
  return {
    ...(context ? { context } : {}),
    ...(data ? { data } : {}),
    origin,
    type,
  } as DiagnosticEventInput<Type>
}

export function parseDiagnosticEventInput(
  value: unknown,
  allowedOrigins: ReadonlySet<DiagnosticOrigin> = new Set(DIAGNOSTIC_ORIGINS),
): DiagnosticEventInput {
  const input = objectValue(value)
  if (!isDiagnosticOrigin(input.origin) || !allowedOrigins.has(input.origin)) invalid()
  if (!isDiagnosticType(input.type)) invalid()
  const type = input.type
  const context = input.context === undefined ? undefined : parseDiagnosticContext(input.context)
  const data = input.data === undefined ? undefined : parseDiagnosticData(type, input.data)
  validateRequiredEventFields(type, context, data)
  return createDiagnosticEventInput(type, input.origin, context, data)
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

export function parseDiagnosticData<Type extends DiagnosticType>(
  type: Type,
  value: unknown,
): DiagnosticDataForType<Type> {
  const input = objectValue(value)
  const entries = Object.entries(input)
  if (entries.length > 32) invalid()
  const normalizedEntries = entries.map(([key, candidate]) => {
    if (!isDiagnosticDataKey(key) || !allowsDiagnosticDataKey(type, key)) invalid()
    const definition = diagnosticDataFields[key]
    if (!isDiagnosticDataValue(candidate, definition, type, key)) invalid()
    return [
      key,
      definition.kind === "error" ? Object.freeze({ ...objectValue(candidate) }) : candidate,
    ]
  })
  return Object.freeze(Object.fromEntries(normalizedEntries)) as DiagnosticDataForType<Type>
}

function isDiagnosticDataKey(value: string): value is DiagnosticDataKey {
  return Object.hasOwn(diagnosticDataFields, value)
}

function allowsDiagnosticDataKey(type: DiagnosticType, key: DiagnosticDataKey): boolean {
  return (diagnosticDataKeysByType[type] as readonly DiagnosticDataKey[]).includes(key)
}

function validateRequiredEventFields(
  type: DiagnosticType,
  context: DiagnosticContext | undefined,
  data: DiagnosticData | undefined,
): void {
  const requiredContextKeys = diagnosticRequiredContextKeysByType[
    type as keyof typeof diagnosticRequiredContextKeysByType
  ] as readonly (typeof identifierFields)[number][] | undefined
  if (requiredContextKeys?.some((key) => context?.[key] === undefined)) invalid()

  const requiredDataKeys = diagnosticRequiredDataKeysByType[
    type as keyof typeof diagnosticRequiredDataKeysByType
  ] as readonly DiagnosticDataKey[] | undefined
  if (requiredDataKeys?.some((key) => data?.[key] === undefined)) invalid()
}

function isDiagnosticDataValue(
  value: unknown,
  definition: DiagnosticDataFieldDefinition,
  type: DiagnosticType,
  key: DiagnosticDataKey,
): boolean {
  if (definition.kind === "boolean") return typeof value === "boolean"
  if (definition.kind === "error") return isErrorData(value)
  if (definition.kind === "number")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= definition.maximum
    )
  if (definition.kind === "timestamp")
    return typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value))
  return typeof value === "string" && enumValuesFor(type, key, definition.values).includes(value)
}

function enumValuesFor(
  type: DiagnosticType,
  key: DiagnosticDataKey,
  fallback: readonly string[],
): readonly string[] {
  const overrides: Partial<
    Record<DiagnosticType, Partial<Record<DiagnosticDataKey, readonly string[]>>>
  > = diagnosticDataValueOverridesByType
  return overrides[type]?.[key] ?? fallback
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
        (key === "status" &&
          typeof candidate === "number" &&
          Number.isSafeInteger(candidate) &&
          candidate >= 0 &&
          candidate <= 999) ||
        (key === "category" &&
          typeof candidate === "string" &&
          (diagnosticErrorCategories as readonly string[]).includes(candidate)) ||
        (key === "phase" &&
          typeof candidate === "string" &&
          (diagnosticErrorPhases as readonly string[]).includes(candidate)),
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
