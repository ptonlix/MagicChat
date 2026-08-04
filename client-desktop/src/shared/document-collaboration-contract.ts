import type { AuthenticatedTarget } from "@shared/client-contract"

export const DOCUMENT_COLLABORATION_LIMITS = Object.freeze({
  // WebSocket 创建后等待握手完成的最长时间，超时后主动关闭会话。
  connectionHandshakeTimeoutMs: 15_000,
  // 获取 Cookie 和解析代理等连接准备工作的最长等待时间。
  connectionPreparationTimeoutMs: 15_000,
  // 发送队列存在积压时，两次尝试排空队列之间的间隔。
  drainIntervalMs: 20,
  // 单个协作协议二进制帧允许的最大字节数。
  maxFrameBytes: 16 * 1024 * 1024,
  // 每个 Renderer 同时运行的底层连接准备任务数量上限。
  maxOwnerPreparations: 8,
  // 每个 Renderer 的 pending 连接与活动会话总数上限。
  maxOwnerSessions: 8,
  // 单个会话发送队列或 Renderer 待处理事件允许占用的最大字节数。
  maxQueueBytes: 32 * 1024 * 1024,
})

export type DocumentCollaborationErrorCode =
  | "auth_failed"
  | "backpressure_limit"
  | "connection_closed"
  | "connection_failed"
  | "frame_too_large"
  | "invalid_frame"
  | "invalid_session"
  | "permission_denied"
  | "resource_limit"
  | "tls_failed"

export type DocumentCollaborationEvent = Readonly<
  | { connectionId: string; sessionId: string; type: "open" }
  | { connectionId: string; data: Uint8Array; sessionId: string; type: "message" }
  | { code: number; connectionId: string; reason: string; sessionId: string; type: "close" }
  | {
      code: DocumentCollaborationErrorCode
      connectionId: string
      sessionId: string
      type: "error"
    }
>

export interface DocumentCollaborationBridge {
  cancel(connectionId: string): Promise<void>
  close(sessionId: string): Promise<void>
  connect(
    target: AuthenticatedTarget,
    documentId: string,
    connectionId: string,
  ): Promise<Readonly<{ sessionId: string }>>
  send(sessionId: string, frame: Uint8Array): Promise<void>
  subscribe(listener: (event: DocumentCollaborationEvent) => void): () => void
}

export function parseDocumentUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error("文档标识无效")
  }
  return value.toLowerCase()
}

export function parseDocumentSessionId(value: unknown): string {
  return parseVersionFourUuid(value, "文档协作会话无效")
}

export function parseDocumentConnectionId(value: unknown): string {
  return parseVersionFourUuid(value, "文档协作连接标识无效")
}

function parseVersionFourUuid(value: unknown, message: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error(message)
  }
  return value.toLowerCase()
}

export function copyDocumentFrame(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error("文档协作帧无效")
  }
  if (value.byteLength > DOCUMENT_COLLABORATION_LIMITS.maxFrameBytes) {
    throw new Error("文档协作帧超过限制")
  }
  return Uint8Array.from(value)
}
