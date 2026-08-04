import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import WebSocket, { type RawData } from "ws"
import { HttpsProxyAgent } from "https-proxy-agent"

import { targetKey, type AuthenticatedTarget } from "@shared/client-contract"
import {
  DOCUMENT_COLLABORATION_LIMITS,
  copyDocumentFrame,
  parseDocumentConnectionId,
  parseDocumentSessionId,
  parseDocumentUuid,
  type DocumentCollaborationErrorCode,
  type DocumentCollaborationEvent,
} from "@shared/document-collaboration-contract"
import type { ProxyAuthPrompt } from "@main/proxy-auth"
import {
  resolveProxy,
  systemCertificateAuthorities,
  withProxyCredentials,
} from "@main/realtime-controller"
import type { ServerProfiles } from "@main/server-profiles"
import type { SessionController } from "@main/session-controller"

type CollaborationSession = {
  connectionId: string
  connectTimer?: NodeJS.Timeout
  documentId: string
  flushTimer?: NodeJS.Timeout
  ownerId: number
  queue: Buffer[]
  queuedBytes: number
  sessionId: string
  socket: WebSocket
  state: "connecting" | "open" | "closing" | "closed"
  target: AuthenticatedTarget
}

type PendingCollaborationConnection = {
  cancelled: boolean
  connectionId: string
  documentId: string
  ownerId: number
  reservationId: string
  target: AuthenticatedTarget
}

export class DocumentCollaborationController extends EventEmitter {
  private accepting = true
  private readonly ownerPreparationCounts = new Map<number, number>()
  private readonly pendingConnections = new Map<string, PendingCollaborationConnection>()
  private readonly sessions = new Map<string, CollaborationSession>()

  constructor(
    private readonly profiles: ServerProfiles,
    private readonly networkSessions: SessionController,
    private readonly proxyAuth?: ProxyAuthPrompt,
  ) {
    super()
  }

  async connect(
    ownerId: number,
    target: AuthenticatedTarget,
    rawDocumentId: unknown,
    rawConnectionId: unknown,
  ): Promise<Readonly<{ sessionId: string }>> {
    if (!this.accepting) throw new Error("文档协作正在关闭")
    const documentId = parseDocumentUuid(rawDocumentId)
    const connectionId = parseDocumentSessionId(rawConnectionId)
    this.assertTarget(target)
    const immutableTarget = Object.freeze({ ...target })
    const immutableTargetKey = targetKey(immutableTarget)
    const duplicate = [...this.sessions.values()].find(
      (session) =>
        session.ownerId === ownerId &&
        targetKey(session.target) === immutableTargetKey &&
        session.documentId === documentId,
    )
    const duplicatePendingCount = [...this.pendingConnections.values()].filter(
      (pending) =>
        pending.ownerId === ownerId &&
        targetKey(pending.target) === immutableTargetKey &&
        pending.documentId === documentId,
    ).length
    const connectionCountAfterReplacement =
      this.ownerConnectionCount(ownerId) - (duplicate ? 1 : 0) - duplicatePendingCount
    if (connectionCountAfterReplacement >= DOCUMENT_COLLABORATION_LIMITS.maxOwnerSessions) {
      throw new Error("文档协作会话数量超过限制")
    }
    this.assertPreparationCapacity(ownerId)
    if (duplicate) this.dispose(duplicate, 1000, "replaced")
    this.cancelPending(
      (pending) =>
        pending.ownerId === ownerId &&
        targetKey(pending.target) === immutableTargetKey &&
        pending.documentId === documentId,
    )
    const reservation: PendingCollaborationConnection = {
      cancelled: false,
      connectionId,
      documentId,
      ownerId,
      reservationId: randomUUID(),
      target: immutableTarget,
    }
    this.pendingConnections.set(reservation.reservationId, reservation)

    try {
      const profile = this.profiles.require(immutableTarget.id)
      const networkSession = this.networkSessions.for(profile)
      const url = buildDocumentCollaborationUrl(profile.normalizedUrl)
      this.acquirePreparation(ownerId)
      const preparation = this.trackPreparation(ownerId, () =>
        Promise.all([
          networkSession.cookies.get({ url: profile.normalizedUrl }),
          resolveProxy(networkSession, url),
        ]),
      )
      const [cookies, proxy] = await withTimeout(
        preparation,
        DOCUMENT_COLLABORATION_LIMITS.connectionPreparationTimeoutMs,
        "文档协作连接准备超时",
      )
      if (
        reservation.cancelled ||
        !this.accepting ||
        this.pendingConnections.get(reservation.reservationId) !== reservation
      ) {
        throw new Error("文档协作连接已取消")
      }
      this.assertTarget(immutableTarget)
      this.pendingConnections.delete(reservation.reservationId)
      const agent = proxy
        ? new HttpsProxyAgent(
            withProxyCredentials(proxy, this.proxyAuth?.getCredentials(new URL(proxy).hostname)),
          )
        : undefined
      const socket = new WebSocket(url, {
        agent,
        ca: systemCertificateAuthorities(),
        headers: {
          Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
          Origin: new URL(profile.normalizedUrl).origin,
        },
        maxPayload: DOCUMENT_COLLABORATION_LIMITS.maxFrameBytes,
        handshakeTimeout: DOCUMENT_COLLABORATION_LIMITS.connectionHandshakeTimeoutMs,
        perMessageDeflate: false,
        rejectUnauthorized: true,
      })
      const sessionId = randomUUID()
      const session: CollaborationSession = {
        connectionId,
        documentId,
        ownerId,
        queue: [],
        queuedBytes: 0,
        sessionId,
        socket,
        state: "connecting",
        target: immutableTarget,
      }
      this.sessions.set(sessionId, session)
      session.connectTimer = setTimeout(() => {
        if (!this.isCurrent(session, socket) || session.state !== "connecting") return
        this.fail(session, "connection_failed", 1013)
      }, DOCUMENT_COLLABORATION_LIMITS.connectionHandshakeTimeoutMs)
      socket.on("open", () => {
        if (!this.isCurrent(session, socket)) return
        this.clearConnectTimer(session)
        session.state = "open"
        this.publish(session, { connectionId, sessionId, type: "open" })
        this.flush(session)
      })
      socket.on("message", (data, binary) => this.receive(session, socket, data, binary))
      socket.on("error", (error) => {
        if (!this.isCurrent(session, socket)) return
        const code: DocumentCollaborationErrorCode = /certificate|tls|ssl/i.test(error.message)
          ? "tls_failed"
          : "connection_failed"
        this.publish(session, { code, connectionId, sessionId, type: "error" })
      })
      socket.on("close", (code, reason) => {
        if (!this.isCurrent(session, socket)) return
        session.state = "closed"
        this.sessions.delete(sessionId)
        this.release(session)
        this.publish(session, {
          code,
          connectionId,
          reason: normalizeCloseReason(code, reason.toString()),
          sessionId,
          type: "close",
        })
      })
      return Object.freeze({ sessionId })
    } finally {
      this.pendingConnections.delete(reservation.reservationId)
    }
  }

  send(ownerId: number, rawSessionId: unknown, value: unknown): void {
    const session = this.requireOwned(ownerId, rawSessionId)
    if (
      value instanceof Uint8Array &&
      value.byteLength > DOCUMENT_COLLABORATION_LIMITS.maxFrameBytes
    ) {
      this.fail(session, "frame_too_large", 1009)
      throw new Error("文档协作帧超过限制")
    }
    const frame = Buffer.from(copyDocumentFrame(value))
    if (!frameMatchesDocument(frame, session.documentId)) {
      this.fail(session, "invalid_frame", 1008)
      throw new Error("文档协作帧与会话不匹配")
    }
    if (session.state === "closing" || session.state === "closed") {
      throw new Error("文档协作连接已关闭")
    }
    if (session.state !== "open" || session.queue.length > 0 || session.socket.bufferedAmount > 0) {
      if (session.queuedBytes + frame.byteLength > DOCUMENT_COLLABORATION_LIMITS.maxQueueBytes) {
        this.fail(session, "backpressure_limit", 1009)
        throw new Error("文档协作发送队列超过限制")
      }
      session.queue.push(frame)
      session.queuedBytes += frame.byteLength
      this.scheduleFlush(session)
      return
    }
    session.socket.send(frame)
  }

  close(ownerId: number, rawSessionId: unknown): void {
    const sessionId = parseDocumentSessionId(rawSessionId)
    const session = this.sessions.get(sessionId)
    if (!session || session.ownerId !== ownerId) return
    this.dispose(session, 1000, "client closed")
  }

  cancel(ownerId: number, rawConnectionId: unknown): void {
    const connectionId = parseDocumentConnectionId(rawConnectionId)
    this.cancelPending(
      (pending) => pending.ownerId === ownerId && pending.connectionId === connectionId,
    )
  }

  closeOwner(ownerId: number): void {
    this.cancelPending((pending) => pending.ownerId === ownerId)
    for (const session of [...this.sessions.values()]) {
      if (session.ownerId === ownerId) this.dispose(session, 1000, "owner closed")
    }
  }

  closeTarget(target: AuthenticatedTarget): void {
    const key = targetKey(target)
    this.cancelPending((pending) => targetKey(pending.target) === key)
    for (const session of [...this.sessions.values()]) {
      if (targetKey(session.target) === key) this.dispose(session, 1000, "target closed")
    }
  }

  closeServer(serverId: string): void {
    this.cancelPending((pending) => pending.target.id === serverId)
    for (const session of [...this.sessions.values()]) {
      if (session.target.id === serverId) this.dispose(session, 1000, "server removed")
    }
  }

  closeAll(): void {
    this.cancelPending(() => true)
    for (const session of [...this.sessions.values()]) {
      this.dispose(session, 1001, "application closing")
    }
  }

  shutdown(): void {
    this.accepting = false
    this.closeAll()
  }

  private assertTarget(target: AuthenticatedTarget): void {
    const profile = this.profiles.require(target.id)
    if (
      profile.normalizedUrl !== target.normalizedUrl ||
      !target.userId ||
      profile.lastUserId !== target.userId
    ) {
      throw new Error("认证目标已失效")
    }
  }

  private cancelPending(predicate: (pending: PendingCollaborationConnection) => boolean): void {
    for (const [reservationId, pending] of [...this.pendingConnections]) {
      if (!predicate(pending)) continue
      pending.cancelled = true
      this.pendingConnections.delete(reservationId)
    }
  }

  private acquirePreparation(ownerId: number): void {
    this.assertPreparationCapacity(ownerId)
    const count = this.ownerPreparationCounts.get(ownerId) ?? 0
    this.ownerPreparationCounts.set(ownerId, count + 1)
  }

  private assertPreparationCapacity(ownerId: number): void {
    const count = this.ownerPreparationCounts.get(ownerId) ?? 0
    if (count >= DOCUMENT_COLLABORATION_LIMITS.maxOwnerPreparations) {
      throw new Error("文档协作连接准备任务数量超过限制")
    }
  }

  private trackPreparation<T>(ownerId: number, start: () => Promise<T>): Promise<T> {
    let preparation: Promise<T>
    try {
      preparation = start()
    } catch (error) {
      this.releasePreparation(ownerId)
      throw error
    }
    const release = () => this.releasePreparation(ownerId)
    void preparation.then(release, release)
    return preparation
  }

  private releasePreparation(ownerId: number): void {
    const count = this.ownerPreparationCounts.get(ownerId) ?? 0
    if (count <= 1) this.ownerPreparationCounts.delete(ownerId)
    else this.ownerPreparationCounts.set(ownerId, count - 1)
  }

  private ownerConnectionCount(ownerId: number): number {
    let count = 0
    for (const pending of this.pendingConnections.values()) {
      if (pending.ownerId === ownerId) count += 1
    }
    for (const session of this.sessions.values()) {
      if (session.ownerId === ownerId) count += 1
    }
    return count
  }

  private receive(
    session: CollaborationSession,
    socket: WebSocket,
    data: RawData,
    binary: boolean,
  ): void {
    if (!this.isCurrent(session, socket)) return
    const frame = rawDataToBuffer(data)
    if (!binary || frame.byteLength === 0) {
      this.fail(session, "invalid_frame", 1003)
      return
    }
    if (!frameMatchesDocument(frame, session.documentId)) {
      this.fail(session, "invalid_frame", 1008)
      return
    }
    if (frame.byteLength > DOCUMENT_COLLABORATION_LIMITS.maxFrameBytes) {
      this.fail(session, "frame_too_large", 1009)
      return
    }
    this.publish(session, {
      connectionId: session.connectionId,
      data: Uint8Array.from(frame),
      sessionId: session.sessionId,
      type: "message",
    })
  }

  private requireOwned(ownerId: number, rawSessionId: unknown): CollaborationSession {
    const sessionId = parseDocumentSessionId(rawSessionId)
    const session = this.sessions.get(sessionId)
    if (!session || session.ownerId !== ownerId) throw new Error("文档协作会话无效")
    return session
  }

  private flush(session: CollaborationSession): void {
    if (!this.isCurrent(session, session.socket) || session.state !== "open") return
    while (session.queue.length > 0 && session.socket.bufferedAmount === 0) {
      const frame = session.queue.shift()
      if (!frame) break
      session.queuedBytes -= frame.byteLength
      session.socket.send(frame)
    }
    if (session.queue.length > 0) this.scheduleFlush(session)
  }

  private scheduleFlush(session: CollaborationSession): void {
    if (session.flushTimer || session.state === "closed") return
    session.flushTimer = setTimeout(() => {
      session.flushTimer = undefined
      this.flush(session)
    }, DOCUMENT_COLLABORATION_LIMITS.drainIntervalMs)
  }

  private fail(
    session: CollaborationSession,
    code: DocumentCollaborationErrorCode,
    closeCode: number,
  ): void {
    this.publish(session, {
      code,
      connectionId: session.connectionId,
      sessionId: session.sessionId,
      type: "error",
    })
    this.dispose(session, closeCode, code)
  }

  private dispose(session: CollaborationSession, code: number, reason: string): void {
    if (!this.sessions.delete(session.sessionId)) return
    session.state = "closing"
    this.release(session)
    this.publish(session, {
      code,
      connectionId: session.connectionId,
      reason,
      sessionId: session.sessionId,
      type: "close",
    })
    if (
      session.socket.readyState === WebSocket.OPEN ||
      session.socket.readyState === WebSocket.CONNECTING
    ) {
      // CONNECTING 状态调用 close() 后，ws 会异步发出 error；关闭完成前必须保留监听器。
      session.socket.once("close", () => session.socket.removeAllListeners())
      session.socket.close(code, reason)
    } else {
      session.socket.removeAllListeners()
    }
    session.state = "closed"
  }

  private release(session: CollaborationSession): void {
    this.clearConnectTimer(session)
    if (session.flushTimer) clearTimeout(session.flushTimer)
    session.flushTimer = undefined
    session.queue = []
    session.queuedBytes = 0
  }

  private clearConnectTimer(session: CollaborationSession): void {
    if (session.connectTimer) clearTimeout(session.connectTimer)
    session.connectTimer = undefined
  }

  private isCurrent(session: CollaborationSession, socket: WebSocket): boolean {
    return this.sessions.get(session.sessionId) === session && session.socket === socket
  }

  private publish(session: CollaborationSession, event: DocumentCollaborationEvent): void {
    this.emit("event", session.ownerId, event)
  }
}

export function buildDocumentCollaborationUrl(normalizedUrl: string): URL {
  const url = new URL("/api/client/document/collaboration", `${normalizedUrl}/`)
  if (url.protocol === "https:") url.protocol = "wss:"
  else if (url.protocol === "http:" && isLocalhost(url.hostname)) url.protocol = "ws:"
  else throw new Error("文档协作仅允许安全连接")
  return url
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  )
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

function normalizeCloseReason(code: number, reason: string): string {
  if (code === 4403) return "permission_denied"
  if (code === 4401) return "auth_failed"
  if (reason === "frame_too_large" || reason === "backpressure_limit") return reason
  return code === 1000 ? "closed" : "connection_closed"
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function frameMatchesDocument(frame: Uint8Array, documentId: string): boolean {
  // Hocuspocus 的连接级 ping/pong 只有一个消息类型字节，不携带文档路由名。
  if (frame.byteLength === 1 && (frame[0] === 9 || frame[0] === 10)) return true
  const length = readVarUint(frame)
  if (!length || length.value <= 0 || length.offset + length.value > frame.byteLength) return false
  try {
    return (
      new TextDecoder("utf-8", { fatal: true }).decode(
        frame.subarray(length.offset, length.offset + length.value),
      ) === documentId
    )
  } catch {
    return false
  }
}

function readVarUint(frame: Uint8Array): { offset: number; value: number } | null {
  let value = 0
  let shift = 0
  for (let offset = 0; offset < Math.min(frame.byteLength, 5); offset += 1) {
    const byte = frame[offset]
    if (byte === undefined) return null
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { offset: offset + 1, value }
    shift += 7
  }
  return null
}
