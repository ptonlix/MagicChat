import { app } from "electron"
import {
  assertClientPath,
  ClientTransportError,
  normalizeTransportError,
  type AuthenticatedTarget,
  type ClientRequest,
  type ClientResponse,
  targetKey,
} from "@shared/client-contract"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"

const ALLOWED_HEADERS = new Set([
  "accept",
  "content-type",
  "if-match",
  "if-none-match",
  "x-client-message-id",
])
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

export class HttpTransport {
  private readonly pending = new Map<string, PendingHttpRequest>()

  constructor(
    private readonly profiles: ServerProfiles,
    private readonly sessions: SessionController,
    private readonly lifecycle: Readonly<{
      onUserChanged?: (serverId: string) => void
    }> = {},
  ) {}

  cancel(requestId: string, ownerId: number): void {
    this.terminate(this.pending.get(pendingKey(ownerId, requestId)), "aborted")
  }

  cancelOwner(ownerId: number): void {
    this.cancelWhere((pending) => pending.ownerId === ownerId)
  }

  cancelTarget(target: AuthenticatedTarget): void {
    const key = targetKey(target)
    this.cancelWhere((pending) => pending.targetKey === key)
  }

  cancelServer(serverId: string): void {
    this.cancelWhere((pending) => pending.serverId === serverId)
  }

  cancelAll(): void {
    this.cancelWhere(() => true)
  }

  async request<T>(
    ownerId: number,
    target: AuthenticatedTarget,
    request: ClientRequest,
  ): Promise<ClientResponse<T>> {
    validateRequest(request)
    const profile = this.profiles.require(target.id)
    if (
      profile.normalizedUrl !== target.normalizedUrl ||
      (!isAuthenticationPath(request.path) &&
        (!target.userId || target.userId === "anonymous" || profile.lastUserId !== target.userId))
    )
      throw new ClientTransportError("invalid_request", "认证目标已失效")
    const key = pendingKey(ownerId, request.requestId)
    if (this.pending.has(key)) throw new ClientTransportError("invalid_request", "请求标识重复")
    const controller = new AbortController()
    const pending: PendingHttpRequest = {
      controller,
      ownerId,
      requestId: request.requestId,
      serverId: target.id,
      targetKey: targetKey(target),
    }
    this.pending.set(key, pending)
    const timeout = setTimeout(
      () => this.terminate(pending, "timeout"),
      clampTimeout(request.timeoutMs),
    )
    try {
      const requestUrl = `${profile.normalizedUrl}${assertClientPath(request.path)}`
      const headers = filterHeaders(request.headers)
      headers.Origin = new URL(profile.normalizedUrl).origin
      const response = await this.sessions.for(profile).fetch(requestUrl, {
        body: encodeBody(request),
        credentials: "same-origin",
        headers,
        method: request.method,
        redirect: "follow",
        signal: controller.signal,
      })
      assertAllowedResponseUrl(response.url, requestUrl, profile.normalizedUrl)
      const bytes = await readLimited(response, MAX_RESPONSE_BYTES)
      const contentType = response.headers.get("content-type") ?? ""
      const body = contentType.includes("application/json")
        ? JSON.parse(new TextDecoder().decode(bytes) || "null")
        : contentType.startsWith("text/")
          ? new TextDecoder().decode(bytes)
          : bytes
      if (response.ok && isAuthenticationResponse(request.path, body)) {
        const previousUserId = profile.lastUserId
        await this.profiles.recordUser(profile.id, body.data.user.id)
        if (previousUserId && previousUserId !== body.data.user.id)
          this.lifecycle.onUserChanged?.(profile.id)
      }
      return {
        body: body as T,
        headers: responseHeaders(response.headers),
        status: response.status,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = pending.terminationReason === "timeout"
        throw new ClientTransportError(
          timeoutError ? "timeout" : "aborted",
          timeoutError ? "请求超时" : "请求已取消",
        )
      }
      const message = error instanceof Error ? error.message : ""
      if (/certificate|tls|ssl/i.test(message))
        throw new ClientTransportError("tls", "服务器证书验证失败")
      throw normalizeTransportError(error)
    } finally {
      clearTimeout(timeout)
      if (this.pending.get(key) === pending) this.pending.delete(key)
    }
  }

  private cancelWhere(predicate: (pending: PendingHttpRequest) => boolean): void {
    for (const pending of this.pending.values()) {
      if (predicate(pending)) this.terminate(pending, "aborted")
    }
  }

  private terminate(
    pending: PendingHttpRequest | undefined,
    reason: NonNullable<PendingHttpRequest["terminationReason"]>,
  ): void {
    if (!pending || pending.controller.signal.aborted) return
    pending.terminationReason = reason
    pending.controller.abort()
  }
}

function isAuthenticationPath(path: string): boolean {
  return path.startsWith("/api/client/auth/") || isClientMePath(path)
}

type PendingHttpRequest = {
  controller: AbortController
  ownerId: number
  requestId: string
  serverId: string
  targetKey: string
  terminationReason?: "aborted" | "timeout"
}

function pendingKey(ownerId: number, requestId: string): string {
  return `${ownerId}:${requestId}`
}

function isAuthenticationResponse(
  path: string,
  body: unknown,
): body is { data: { user: { id: string } } } {
  if (
    !(
      path.includes("/auth/login") ||
      path.includes("/auth/email-code/login") ||
      isClientMePath(path)
    )
  )
    return false
  const value = body as { data?: { user?: { id?: unknown } } }
  return typeof value?.data?.user?.id === "string"
}

function isClientMePath(path: string): boolean {
  return (
    path === "/api/client/me" ||
    path.startsWith("/api/client/me/") ||
    path.startsWith("/api/client/me?")
  )
}

function validateRequest(request: ClientRequest): void {
  assertClientPath(request.path)
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId))
    throw new ClientTransportError("invalid_request", "请求标识无效")
  if (!(["DELETE", "GET", "PATCH", "POST", "PUT"] as const).includes(request.method))
    throw new ClientTransportError("invalid_request", "请求方法无效")
  if (app.isPackaged && request.path.startsWith("//"))
    throw new ClientTransportError("invalid_request", "请求路径无效")
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
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
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

function assertAllowedResponseUrl(
  responseUrl: string,
  requestUrl: string,
  serverUrl: string,
): void {
  // 测试构造的 Response 没有关联 URL；真实 Electron 响应始终提供最终 URL。
  if (!responseUrl || responseUrl === requestUrl) return
  const response = new URL(responseUrl)
  const server = new URL(serverUrl)
  if (response.origin !== server.origin || !response.pathname.startsWith("/api/client/")) {
    throw new ClientTransportError("invalid_request", "服务器重定向超出允许范围")
  }
}

function clampTimeout(value?: number): number {
  return Math.min(120_000, Math.max(1_000, value ?? 30_000))
}
