import {
  isDocumentUuid,
  isServerId,
  type DocumentWindowErrorCode,
  type DocumentWindowOpenResponse,
  type DocumentWindowOpenStatus,
} from "@shared/document-window-contract"

export type DocumentWindowRouteContext = Readonly<{
  documentId: string
  mode: "document"
  serverId: string
}>

type DocumentNavigationLocation = Readonly<Pick<Location, "hash" | "pathname" | "search">>

let lastNonDocumentRoute: string | undefined

export type DocumentWindowRouteState =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "document"; context: DocumentWindowRouteContext }>
  | Readonly<{ kind: "invalid"; message: string }>

export function isDocumentRoutePath(pathname: string): boolean {
  return pathname === "/documents/document" || pathname.startsWith("/documents/document/")
}

export function rememberLastNonDocumentRoute(location: DocumentNavigationLocation): void {
  if (isDocumentRoutePath(location.pathname)) return

  const route = `${location.pathname}${location.search}${location.hash}`
  if (!isRememberableRoute(route)) {
    lastNonDocumentRoute = undefined
    return
  }
  lastNonDocumentRoute = route
}

export function getDocumentReturnPath(fallback: string): string {
  return lastNonDocumentRoute && isRememberableRoute(lastNonDocumentRoute)
    ? lastNonDocumentRoute
    : fallback
}

export class DocumentWindowOpenError extends Error {
  readonly code: DocumentWindowErrorCode | "bridge_unavailable"

  constructor(code: DocumentWindowErrorCode | "bridge_unavailable", message: string) {
    super(message)
    this.name = "DocumentWindowOpenError"
    this.code = code
  }
}

export function parseDocumentWindowLocation(
  location: Pick<Location, "pathname" | "search"> = window.location,
): DocumentWindowRouteState {
  const prefix = "/documents/document/"
  if (!location.pathname.startsWith(prefix)) return { kind: "none" }

  const windowMode = new URLSearchParams(location.search).get("window")
  if (windowMode !== "document") {
    return windowMode === null ? { kind: "none" } : { kind: "invalid", message: "文档窗口模式无效" }
  }

  const encodedDocumentId = location.pathname.slice(prefix.length)
  if (!encodedDocumentId || encodedDocumentId.includes("/"))
    return { kind: "invalid", message: "文档窗口参数无效" }

  let documentId: string
  try {
    documentId = decodeURIComponent(encodedDocumentId).toLowerCase()
  } catch {
    return { kind: "invalid", message: "文档标识编码无效" }
  }

  const serverId = new URLSearchParams(location.search).get("serverId") ?? ""
  if (!isDocumentUuid(documentId) || !isServerId(serverId))
    return { kind: "invalid", message: "文档窗口认证目标无效" }

  return Object.freeze({
    context: Object.freeze({ documentId, mode: "document" as const, serverId }),
    kind: "document" as const,
  })
}

export async function requestDocumentWindow(
  documentId: string,
  serverId: string,
): Promise<{ status: DocumentWindowOpenStatus }> {
  let response: DocumentWindowOpenResponse
  try {
    response = await window.desktop.navigation.openDocumentWindow(documentId, serverId)
  } catch (error) {
    if (error instanceof DocumentWindowOpenError) throw error
    throw new DocumentWindowOpenError(
      "bridge_unavailable",
      error instanceof Error ? error.message : "文档窗口服务暂不可用",
    )
  }

  if (!response.ok) throw new DocumentWindowOpenError(response.error.code, response.error.message)
  return response.result
}

export function documentNavigationPath(documentId: string, serverId: string): string {
  const path = `/documents/document/${encodeURIComponent(documentId)}`
  const current = parseDocumentWindowLocation()
  if (current.kind !== "document" || current.context.serverId !== serverId) return path
  return documentWindowPath(documentId, serverId)
}

export function documentWindowPath(documentId: string, serverId: string): string {
  return `/documents/document/${encodeURIComponent(documentId)}?serverId=${encodeURIComponent(serverId)}&window=document`
}

function isInternalRoute(route: string): boolean {
  return route.startsWith("/") && !route.startsWith("//")
}

function isRememberableRoute(route: string): boolean {
  if (!isInternalRoute(route)) return false
  const pathname = route.split(/[?#]/, 1)[0]
  return ["/chat", "/contacts", "/projects"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function documentWindowFeedbackMessage(
  code: DocumentWindowOpenError["code"],
  fallback: string,
): string {
  switch (code) {
    case "window_limit":
      return "同一服务器最多打开 8 个文档窗口，请先关闭已有窗口。"
    case "not_authenticated":
      return "当前服务器登录状态已失效，请重新登录后重试。"
    case "server_not_found":
      return "目标服务器不可用，请返回服务器设置检查配置。"
    case "target_mismatch":
      return "文档窗口认证目标已变化，请从当前服务器重新打开。"
    case "invalid_request":
      return "文档窗口参数无效，请刷新后重试。"
    case "disposed":
      return "应用正在退出，请稍后重试。"
    case "load_failed":
      return "文档窗口加载失败，请重试。"
    default:
      return fallback
  }
}
