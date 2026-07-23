import { targetKey, type AuthenticatedTarget, type RealtimeEnvelope } from "@shared/client-contract"
import type { RealtimeWebSocketLike } from "@/lib/realtime-client"
import { randomUUID } from "./random-id"

export function installDesktopFetch(target: AuthenticatedTarget): () => void {
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url, window.location.href)
    if (!url.pathname.startsWith("/api/client/")) return original(input, init)
    const method = request.method.toUpperCase() as "DELETE" | "GET" | "PATCH" | "POST" | "PUT"
    if (request.body && request.headers.get("content-type")?.includes("multipart/form-data")) {
      return streamMultipartRequest(target, request, `${url.pathname}${url.search}`, method)
    }
    let body: { kind: "text"; value: string } | undefined
    if (method !== "GET" && method !== "DELETE") body = { kind: "text", value: await request.text() }
    const response = await window.desktop.transport.request(target, {
      body,
      headers: Object.fromEntries(request.headers.entries()),
      method,
      path: `${url.pathname}${url.search}`,
      requestId: randomUUID(),
    })
    const headers = new Headers(response.headers)
    const responseBody = response.body instanceof Uint8Array ? new Blob([Uint8Array.from(response.body)]) : typeof response.body === "string" ? response.body : JSON.stringify(response.body)
    if (url.pathname.endsWith("/auth/login") || url.pathname.endsWith("/auth/email-code/login") || url.pathname.endsWith("/me")) {
      const data = response.body as { data?: { user?: { id?: string } } }
      if (data?.data?.user?.id) window.dispatchEvent(new CustomEvent("magicchat:authenticated", { detail: { userId: data.data.user.id } }))
    }
    return new Response(responseBody, { headers, status: response.status })
  }
  return () => { window.fetch = original }
}

async function streamMultipartRequest(
  target: AuthenticatedTarget,
  request: Request,
  path: string,
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT"
): Promise<Response> {
  if (!request.body) throw new Error("上传请求缺少内容")
  const streamId = await window.desktop.transport.streamStart(target, {
    headers: Object.fromEntries(request.headers.entries()),
    method,
    path,
    requestId: randomUUID(),
  })
  const abort = () => { void window.desktop.transport.streamAbort(streamId) }
  request.signal.addEventListener("abort", abort, { once: true })
  try {
    const reader = request.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (let offset = 0; offset < value.byteLength; offset += 256 * 1024) {
        await window.desktop.transport.streamChunk(streamId, value.slice(offset, offset + 256 * 1024))
      }
    }
    const response = await window.desktop.transport.streamFinish(streamId)
    const contentType = response.headers["content-type"] ?? "application/json"
    return new Response(typeof response.body === "string" ? response.body : JSON.stringify(response.body), {
      headers: { "content-type": contentType },
      status: response.status,
    })
  } catch (error) {
    await window.desktop.transport.streamAbort(streamId).catch(() => undefined)
    throw error
  } finally {
    request.signal.removeEventListener("abort", abort)
  }
}

export class DesktopWebSocket implements RealtimeWebSocketLike {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  readyState = DesktopWebSocket.CONNECTING
  private readonly unsubscribe: () => void
  private readonly unsubscribeUnauthorized: () => void

  constructor(private readonly target: AuthenticatedTarget) {
    this.unsubscribe = window.desktop.realtime.subscribe((envelope) => this.receive(envelope))
    this.unsubscribeUnauthorized = window.desktop.realtime.subscribeUnauthorized((target) => {
      if (targetKey(target) !== targetKey(this.target) || this.readyState === DesktopWebSocket.CLOSED) return
      this.readyState = DesktopWebSocket.CLOSED
      this.unsubscribe()
      this.unsubscribeUnauthorized()
      this.onclose?.(new CloseEvent("close", { code: 1008, reason: "unauthorized" }))
    })
    void window.desktop.realtime.connect(target).then(() => {
      this.readyState = DesktopWebSocket.OPEN
      this.onopen?.(new Event("open"))
    }).catch(() => {
      this.readyState = DesktopWebSocket.CLOSED
      this.onerror?.(new Event("error"))
      this.onclose?.(new CloseEvent("close"))
    })
  }

  close(): void {
    if (this.readyState >= DesktopWebSocket.CLOSING) return
    this.readyState = DesktopWebSocket.CLOSING
    this.unsubscribe()
    this.unsubscribeUnauthorized()
    void window.desktop.realtime.close(this.target).finally(() => {
      this.readyState = DesktopWebSocket.CLOSED
      this.onclose?.(new CloseEvent("close"))
    })
  }

  send(data: string): void {
    if (this.readyState !== DesktopWebSocket.OPEN) throw new DOMException("连接尚未建立", "InvalidStateError")
    let request: { id?: string; method?: string; payload?: unknown }
    try { request = JSON.parse(data) as typeof request } catch { throw new Error("实时请求格式无效") }
    if (!request.id || !request.method) throw new Error("实时请求字段无效")
    void window.desktop.realtime.send(this.target, request.method, request.payload).then((payload) => {
      this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ v: 1, kind: "response", ok: true, reply_to: request.id, payload }) }))
    }).catch((error: unknown) => {
      this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ v: 1, kind: "response", ok: false, reply_to: request.id, error: { message: error instanceof Error ? error.message : "实时请求失败" } }) }))
    })
  }

  private receive(envelope: RealtimeEnvelope): void {
    if (envelope.targetKey && !envelope.targetKey.endsWith(`:${encodeURIComponent(this.target.userId)}`)) return
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(envelope) }))
  }
}
