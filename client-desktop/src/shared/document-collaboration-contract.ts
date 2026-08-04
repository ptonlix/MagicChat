import type { AuthenticatedTarget } from "@shared/client-contract"

export const DOCUMENT_COLLABORATION_LIMITS = Object.freeze({
  drainIntervalMs: 20,
  maxFrameBytes: 16 * 1024 * 1024,
  maxOwnerSessions: 8,
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
