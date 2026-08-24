import {
  isDocumentUuid,
  isDocumentWindowDocumentType,
  type DocumentWindowDocumentType,
} from "@shared/document-window-contract"
import type { AuthenticatedTarget } from "@shared/client-contract"

const DOCUMENT_ROUTE_PREFIX = "/documents/"

export type DesktopDocumentLink = Readonly<{
  documentId: string
  documentType: DocumentWindowDocumentType
}>

/** 只识别当前认证 Server 下无歧义的 HTTPS 文档分享链接。 */
export function parseDesktopDocumentLink(
  rawUrl: string,
  target: Pick<AuthenticatedTarget, "normalizedUrl">,
): DesktopDocumentLink | undefined {
  if (!rawUrl || rawUrl.length > 4096 || rawUrl.includes("?") || rawUrl.includes("#"))
    return undefined

  let documentUrl: URL
  let serverUrl: URL
  try {
    documentUrl = new URL(rawUrl)
    serverUrl = new URL(target.normalizedUrl)
  } catch {
    return undefined
  }

  if (
    documentUrl.protocol !== "https:" ||
    serverUrl.protocol !== "https:" ||
    documentUrl.origin !== serverUrl.origin ||
    documentUrl.username ||
    documentUrl.password ||
    documentUrl.search ||
    documentUrl.hash
  )
    return undefined

  const serverPath = normalizePath(serverUrl.pathname)
  const routePrefix = `${serverPath === "/" ? "" : serverPath}${DOCUMENT_ROUTE_PREFIX}`
  if (!documentUrl.pathname.startsWith(routePrefix)) return undefined

  const route = documentUrl.pathname.slice(routePrefix.length).split("/")
  if (route.length !== 2) return undefined
  const [documentType, encodedDocumentId] = route
  if (!isDocumentWindowDocumentType(documentType)) return undefined
  if (!encodedDocumentId || encodedDocumentId.includes("/")) return undefined

  let documentId: string
  try {
    documentId = decodeURIComponent(encodedDocumentId).toLowerCase()
  } catch {
    return undefined
  }

  if (documentId.includes("/") || documentId.includes("\\") || !isDocumentUuid(documentId))
    return undefined
  return Object.freeze({ documentId, documentType })
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/"
}
