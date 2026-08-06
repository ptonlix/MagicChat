export const DOCUMENT_WINDOW_MODE = "document" as const

export const DOCUMENT_WINDOW_LIMITS = Object.freeze({
  maxPerTarget: 8,
  minHeight: 560,
  minWidth: 760,
  defaultHeight: 760,
  defaultWidth: 1120,
})

export type DocumentWindowRequest = Readonly<{
  documentId: string
  serverId: string
}>

export type DocumentWindowOpenStatus = "created" | "focused"

export type DocumentWindowOpenResult = Readonly<{
  status: DocumentWindowOpenStatus
}>

export type DocumentWindowErrorCode =
  | "disposed"
  | "invalid_request"
  | "load_failed"
  | "not_authenticated"
  | "server_not_found"
  | "target_mismatch"
  | "window_limit"

export type DocumentWindowError = Readonly<{
  code: DocumentWindowErrorCode
  message: string
}>

export type DocumentWindowOpenResponse = Readonly<
  { ok: true; result: DocumentWindowOpenResult } | { error: DocumentWindowError; ok: false }
>

export function parseDocumentWindowRequest(value: unknown): DocumentWindowRequest {
  if (!value || typeof value !== "object") throw new Error("文档窗口请求无效")
  const input = value as Record<string, unknown>
  const keys = Object.keys(input).sort()
  if (keys.length !== 2 || keys[0] !== "documentId" || keys[1] !== "serverId")
    throw new Error("文档窗口请求字段无效")
  if (!isDocumentUuid(input.documentId)) throw new Error("文档标识无效")
  if (!isServerId(input.serverId)) throw new Error("服务器标识无效")
  return Object.freeze({
    documentId: input.documentId.toLowerCase(),
    serverId: input.serverId,
  })
}

export function isDocumentUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

export function isServerId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

export function buildDocumentWindowRoute(request: DocumentWindowRequest): string {
  return `magicchat-app://app/documents/document/${encodeURIComponent(request.documentId)}?serverId=${encodeURIComponent(request.serverId)}&window=${DOCUMENT_WINDOW_MODE}`
}

export function documentWindowKey(request: DocumentWindowRequest, userId: string): string {
  return `${request.serverId}:${userId}:${request.documentId}`
}

export function documentWindowTargetKey(serverId: string, userId: string): string {
  return `${serverId}:${userId}`
}

export function createdDocumentWindowResponse(
  status: DocumentWindowOpenStatus,
): DocumentWindowOpenResponse {
  return Object.freeze({
    ok: true,
    result: Object.freeze({ status }),
  })
}

export function failedDocumentWindowResponse(
  code: DocumentWindowErrorCode,
  message: string,
): DocumentWindowOpenResponse {
  return Object.freeze({
    error: Object.freeze({ code, message: message.slice(0, 240) }),
    ok: false,
  })
}

export function normalizeDocumentWindowOpenResponse(value: unknown): DocumentWindowOpenResponse {
  if (!value || typeof value !== "object") throw new Error("文档窗口响应无效")
  const input = value as Record<string, unknown>
  if (input.ok === true) {
    const result = input.result
    if (
      !result ||
      typeof result !== "object" ||
      !["created", "focused"].includes((result as { status?: unknown }).status as string)
    )
      throw new Error("文档窗口结果无效")
    return createdDocumentWindowResponse((result as { status: "created" | "focused" }).status)
  }
  if (input.ok !== false || !input.error || typeof input.error !== "object")
    throw new Error("文档窗口响应无效")
  const error = input.error as Record<string, unknown>
  if (!isDocumentWindowErrorCode(error.code) || typeof error.message !== "string")
    throw new Error("文档窗口错误无效")
  return failedDocumentWindowResponse(error.code, error.message)
}

function isDocumentWindowErrorCode(value: unknown): value is DocumentWindowErrorCode {
  return [
    "disposed",
    "invalid_request",
    "load_failed",
    "not_authenticated",
    "server_not_found",
    "target_mismatch",
    "window_limit",
  ].includes(value as DocumentWindowErrorCode)
}
