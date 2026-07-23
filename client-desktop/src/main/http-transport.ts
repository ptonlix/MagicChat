import { app } from "electron"
import {
  assertClientPath,
  ClientTransportError,
  normalizeTransportError,
  type AuthenticatedTarget,
  type ClientRequest,
  type ClientResponse,
} from "@shared/client-contract"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"

const ALLOWED_HEADERS = new Set(["accept", "content-type", "if-match", "if-none-match", "x-client-message-id"])
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

export class HttpTransport {
  private readonly pending = new Map<string, { controller: AbortController; ownerId: number }>()

  constructor(private readonly profiles: ServerProfiles, private readonly sessions: SessionController) {}

  cancel(requestId: string, ownerId?: number): void {
    const pending = this.pending.get(requestId)
    if (pending && (ownerId === undefined || pending.ownerId === ownerId)) pending.controller.abort()
  }

  cancelOwner(ownerId: number): void {
    for (const [id, pending] of this.pending) if (pending.ownerId === ownerId) this.cancel(id, ownerId)
  }

  async request<T>(ownerId: number, target: AuthenticatedTarget, request: ClientRequest): Promise<ClientResponse<T>> {
    validateRequest(request)
    const profile = this.profiles.require(target.id)
    if (profile.normalizedUrl !== target.normalizedUrl) throw new ClientTransportError("invalid_request", "认证目标已失效")
    if (this.pending.has(request.requestId)) throw new ClientTransportError("invalid_request", "请求标识重复")
    const controller = new AbortController()
    this.pending.set(request.requestId, { controller, ownerId })
    const timeout = setTimeout(() => controller.abort(new Error("timeout")), clampTimeout(request.timeoutMs))
    try {
      const response = await this.sessions.for(profile).fetch(`${profile.normalizedUrl}${assertClientPath(request.path)}`, {
        body: encodeBody(request),
        credentials: "include",
        headers: filterHeaders(request.headers),
        method: request.method,
        redirect: "manual",
        signal: controller.signal,
      })
      const bytes = await readLimited(response, MAX_RESPONSE_BYTES)
      const contentType = response.headers.get("content-type") ?? ""
      const body = contentType.includes("application/json")
        ? JSON.parse(new TextDecoder().decode(bytes) || "null")
        : contentType.startsWith("text/")
          ? new TextDecoder().decode(bytes)
          : bytes
      if (response.ok && isAuthenticationResponse(request.path, body)) {
        await this.profiles.recordUser(profile.id, body.data.user.id)
      }
      return { body: body as T, headers: responseHeaders(response.headers), status: response.status }
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = controller.signal.reason instanceof Error && controller.signal.reason.message === "timeout"
        throw new ClientTransportError(timeoutError ? "timeout" : "aborted", timeoutError ? "请求超时" : "请求已取消")
      }
      const message = error instanceof Error ? error.message : ""
      if (/certificate|tls|ssl/i.test(message)) throw new ClientTransportError("tls", "服务器证书验证失败")
      throw normalizeTransportError(error)
    } finally {
      clearTimeout(timeout)
      this.pending.delete(request.requestId)
    }
  }
}

function isAuthenticationResponse(path: string, body: unknown): body is { data: { user: { id: string } } } {
  if (!(path.includes("/auth/login") || path.includes("/auth/email-code/login") || path.startsWith("/api/client/me"))) return false
  const value = body as { data?: { user?: { id?: unknown } } }
  return typeof value?.data?.user?.id === "string"
}

function validateRequest(request: ClientRequest): void {
  assertClientPath(request.path)
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)) throw new ClientTransportError("invalid_request", "请求标识无效")
  if (!(["DELETE", "GET", "PATCH", "POST", "PUT"] as const).includes(request.method)) throw new ClientTransportError("invalid_request", "请求方法无效")
  if (app.isPackaged && request.path.startsWith("//")) throw new ClientTransportError("invalid_request", "请求路径无效")
}

function filterHeaders(input?: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = { Accept: "application/json" }
  for (const [name, value] of Object.entries(input ?? {})) {
    const lower = name.toLowerCase()
    if (!ALLOWED_HEADERS.has(lower) || value.length > 2048 || /[\r\n]/.test(value)) continue
    result[name] = value
  }
  return result
}

function encodeBody(request: ClientRequest): BodyInit | undefined {
  if (!request.body || request.method === "GET") return undefined
  if (request.body.kind === "json") return JSON.stringify(request.body.value)
  if (request.body.kind === "text") return request.body.value
  return new Blob([Uint8Array.from(request.body.value)])
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > limit) throw new ClientTransportError("response_too_large", "响应内容过大")
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new ClientTransportError("response_too_large", "响应内容过大")
    }
    chunks.push(value)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
}

function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of ["content-type", "etag", "last-modified", "retry-after"]) {
    const value = headers.get(name)
    if (value) result[name] = value
  }
  return result
}

function clampTimeout(value?: number): number {
  return Math.min(120_000, Math.max(1_000, value ?? 30_000))
}
