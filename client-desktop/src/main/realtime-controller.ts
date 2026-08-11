import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import WebSocket from "ws"
import { HttpsProxyAgent } from "https-proxy-agent"
import tls from "node:tls"
import {
  CLIENT_PROTOCOL_VERSION,
  targetKey,
  type AuthenticatedTarget,
  type RealtimeEnvelope,
  type RealtimeSnapshot,
} from "@shared/client-contract"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"
import type { ProxyAuthPrompt } from "@main/proxy-auth"
import type { Diagnostics } from "@main/diagnostics"
import {
  createDiagnosticEventInput,
  type DiagnosticDataForType,
  type DiagnosticType,
} from "@shared/diagnostics-contract"

type Connection = {
  attempt: number
  connectionInstanceId: string
  episodeId: string
  intentionallyClosed: boolean
  pending: Map<
    string,
    { reject(error: Error): void; resolve(value: unknown): void; timer: NodeJS.Timeout }
  >
  ready: boolean
  systemReadyCount: number
  socket?: WebSocket
  status: RealtimeSnapshot["status"]
  target: AuthenticatedTarget
  timer?: NodeJS.Timeout
}

const delays = [500, 1_000, 2_000, 5_000, 10_000, 30_000]

export class RealtimeController extends EventEmitter {
  private readonly connections = new Map<string, Connection>()

  constructor(
    private readonly profiles: ServerProfiles,
    private readonly sessions: SessionController,
    private readonly proxyAuth?: ProxyAuthPrompt,
    private readonly diagnostics?: Diagnostics,
  ) {
    super()
  }

  async connect(target: AuthenticatedTarget): Promise<RealtimeSnapshot> {
    const key = targetKey(target)
    let connection = this.connections.get(key)
    if (!connection) {
      const profile = this.profiles.require(target.id)
      if (profile.normalizedUrl !== target.normalizedUrl) throw new Error("认证目标已失效")
      connection = {
        attempt: 0,
        connectionInstanceId: diagnosticId(),
        episodeId: this.diagnostics?.getCurrentEpisodeId() ?? this.createEpisode("connection"),
        intentionallyClosed: false,
        pending: new Map(),
        ready: false,
        status: "connecting",
        systemReadyCount: 0,
        target,
      }
      this.connections.set(key, connection)
      this.record(connection, "realtime.connection-created", {
        ready: false,
        status: "connecting",
      })
      await this.open(connection)
    }
    return this.snapshot(connection)
  }

  close(target: AuthenticatedTarget): void {
    const key = targetKey(target)
    const connection = this.connections.get(key)
    if (!connection) return
    connection.intentionallyClosed = true
    if (connection.timer) clearTimeout(connection.timer)
    connection.socket?.close(1000, "target closed")
    this.rejectPending(connection, new Error("实时连接已关闭"))
    this.connections.delete(key)
  }

  closeServer(serverId: string): void {
    for (const connection of this.connections.values())
      if (connection.target.id === serverId) this.close(connection.target)
  }

  closeAll(): void {
    for (const connection of [...this.connections.values()]) this.close(connection.target)
  }

  reconnectAll(episodeId?: string): void {
    for (const connection of this.connections.values()) {
      if (connection.intentionallyClosed) continue
      connection.episodeId = episodeId ?? this.createEpisode("reconnect")
      connection.socket?.terminate()
      if (!connection.socket) void this.open(connection)
    }
  }

  async send(target: AuthenticatedTarget, method: string, payload: unknown): Promise<unknown> {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(method)) throw new Error("实时方法无效")
    const connection = this.connections.get(targetKey(target))
    if (!connection?.socket || connection.socket.readyState !== WebSocket.OPEN || !connection.ready)
      throw new Error("实时连接尚未就绪")
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(id)
        reject(new Error("实时请求超时"))
      }, 30_000)
      connection.pending.set(id, { reject, resolve, timer })
      connection.socket!.send(
        JSON.stringify({ v: CLIENT_PROTOCOL_VERSION, kind: "request", id, method, payload }),
      )
    })
  }

  snapshot(connection: Connection): RealtimeSnapshot {
    return {
      connectionInstanceId: connection.connectionInstanceId,
      episodeId: connection.episodeId,
      ready: connection.ready,
      status: connection.status,
      targetKey: targetKey(connection.target),
      targetScope: connection.target.id,
    }
  }

  private async open(connection: Connection): Promise<void> {
    if (connection.intentionallyClosed || connection.socket) return
    const profile = this.profiles.require(connection.target.id)
    const previousStatus = connection.status
    connection.status = connection.attempt === 0 ? "connecting" : "reconnecting"
    this.emitStateSnapshot(connection, previousStatus, connection.ready)
    const cookies = await this.sessions.for(profile).cookies.get({ url: profile.normalizedUrl })
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
    const wsUrl = new URL("/api/client/ws", `${profile.normalizedUrl}/`)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
    const proxy = await resolveProxy(this.sessions.for(profile), wsUrl)
    const agent = proxy
      ? new HttpsProxyAgent(
          withProxyCredentials(proxy, this.proxyAuth?.getCredentials(new URL(proxy).hostname)),
        )
      : undefined
    const socket = new WebSocket(wsUrl, {
      agent,
      ca: systemCertificateAuthorities(),
      headers: { Cookie: cookieHeader, Origin: profile.normalizedUrl },
      perMessageDeflate: false,
      rejectUnauthorized: true,
    })
    connection.socket = socket
    socket.on("open", () => {
      const previousStatus = connection.status
      connection.attempt = 0
      connection.status = "connected"
      this.record(connection, "realtime.socket-opened", {
        previousStatus,
        ready: connection.ready,
        status: connection.status,
      })
      this.emitStateSnapshot(connection, previousStatus, connection.ready)
    })
    socket.on("ping", (data) => socket.pong(data))
    socket.on("message", (data, binary) => {
      const size = Array.isArray(data)
        ? data.reduce((total, item) => total + item.byteLength, 0)
        : data.byteLength
      if (binary || size > 2 * 1024 * 1024) return socket.close(1009, "message too large")
      this.handleMessage(connection, data.toString())
    })
    socket.on("error", () => undefined)
    socket.on("close", (closeCode, reason) => {
      if (connection.socket === socket) connection.socket = undefined
      if (!connection.intentionallyClosed) connection.episodeId = this.createEpisode("reconnect")
      const previousStatus = connection.status
      const previousReady = connection.ready
      connection.ready = false
      this.record(connection, "realtime.socket-closed", {
        closeCode: Math.max(0, Math.min(9_999, closeCode)),
        closeReasonLength: Math.min(256, reason.byteLength),
        previousReady,
        previousStatus,
        reason: classifyCloseReason(reason),
        ready: false,
        status: "reconnecting",
      })
      this.rejectPending(connection, new Error("实时连接已断开"))
      if (connection.intentionallyClosed) return
      connection.status = "reconnecting"
      this.emitStateSnapshot(connection, previousStatus, previousReady)
      void this.checkAuthorizedAndSchedule(connection)
    })
  }

  private handleMessage(connection: Connection, raw: string): void {
    let envelope: RealtimeEnvelope
    try {
      envelope = JSON.parse(raw) as RealtimeEnvelope
    } catch {
      return
    }
    if (envelope.v !== CLIENT_PROTOCOL_VERSION) return
    if (envelope.kind === "event") {
      const previousReady = connection.ready
      if (envelope.event === "system.ready") {
        connection.ready = true
        connection.systemReadyCount += 1
        this.record(connection, "realtime.system-ready", {
          previousReady,
          ready: true,
          status: connection.status,
          systemReadyCount: connection.systemReadyCount,
        })
      }
      const targeted = { ...envelope, targetKey: targetKey(connection.target) }
      this.emit("envelope", targeted)
      if (envelope.event === "system.ready" && !previousReady)
        this.emitStateSnapshot(connection, connection.status, previousReady)
      return
    }
    if (envelope.kind === "response" && envelope.reply_to) {
      const pending = connection.pending.get(envelope.reply_to)
      if (!pending) return
      clearTimeout(pending.timer)
      connection.pending.delete(envelope.reply_to)
      if (envelope.ok) pending.resolve(envelope.payload)
      else pending.reject(new Error(envelope.error?.message ?? "实时请求失败"))
    }
  }

  private async checkAuthorizedAndSchedule(connection: Connection): Promise<void> {
    const profile = this.profiles.require(connection.target.id)
    try {
      const response = await this.sessions
        .for(profile)
        .fetch(`${profile.normalizedUrl}/api/client/me`, { credentials: "include" })
      this.record(connection, "realtime.authorization-checked", {
        responseStatus: Math.max(0, Math.min(999, response.status)),
      })
      if (response.status === 401) {
        connection.intentionallyClosed = true
        connection.status = "disconnected"
        this.emit("unauthorized", connection.target)
        this.emitStateSnapshot(connection, "reconnecting", false)
        return
      }
    } catch {
      // 离线和服务器重启时仍进入有上限退避，不将网络失败误判为退出登录。
      this.record(connection, "realtime.authorization-checked", {
        error: { category: "network", phase: "authorization" },
      })
    }
    const delay = delays[Math.min(connection.attempt++, delays.length - 1)]
    this.record(connection, "realtime.reconnect-scheduled", {
      attempt: connection.attempt,
      durationMs: delay,
    })
    connection.timer = setTimeout(() => {
      connection.timer = undefined
      void this.open(connection)
    }, delay)
  }

  private rejectPending(connection: Connection, error: Error): void {
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    connection.pending.clear()
  }

  private emitStateSnapshot(
    connection: Connection,
    previousStatus: RealtimeSnapshot["status"],
    previousReady: boolean,
  ): void {
    if (previousReady !== connection.ready || previousStatus !== connection.status)
      this.record(connection, "realtime.state-changed", {
        previousReady,
        previousStatus,
        ready: connection.ready,
        status: connection.status,
      })
    this.emit("snapshot", this.snapshot(connection))
  }

  private record(
    connection: Connection,
    type: Extract<DiagnosticType, `realtime.${string}`>,
    data?: DiagnosticDataForType<typeof type>,
  ): void {
    void this.diagnostics?.recordEvent(
      createDiagnosticEventInput(
        type,
        "main",
        {
          connectionInstanceId: connection.connectionInstanceId,
          episodeId: connection.episodeId,
          targetScope: connection.target.id,
        },
        data,
      ),
    )
  }

  private createEpisode(reason: import("@main/diagnostics").DiagnosticEpisodeReason): string {
    return this.diagnostics?.createEpisode(reason) ?? diagnosticId()
  }
}

function diagnosticId(): string {
  return randomUUID().replace(/-/g, "")
}

function classifyCloseReason(reason: Buffer): "authorization" | "network" | "unknown" {
  if (reason.byteLength === 0) return "unknown"
  const value = reason.toString("utf8", 0, 64).toLowerCase()
  if (value.includes("auth") || value.includes("unauthor")) return "authorization"
  return "network"
}

export async function resolveProxy(
  networkSession: import("electron").Session,
  target: URL,
): Promise<string | undefined> {
  const value = await networkSession.resolveProxy(target.toString())
  const first = value.split(";")[0]?.trim()
  if (!first || first === "DIRECT") return undefined
  const [kind, address] = first.split(/\s+/, 2)
  if (!address || (kind !== "PROXY" && kind !== "HTTPS")) return undefined
  return `${kind === "HTTPS" ? "https" : "http"}://${address}`
}

export function withProxyCredentials(
  proxy: string,
  credentials?: { password: string; username: string },
): string {
  if (!credentials) return proxy
  const url = new URL(proxy)
  url.username = credentials.username
  url.password = credentials.password
  return url.toString()
}

export function systemCertificateAuthorities(): string[] | undefined {
  const getCertificates = (tls as typeof tls & { getCACertificates?: (type: "system") => string[] })
    .getCACertificates
  const certificates = getCertificates?.("system")
  return certificates?.length ? [...tls.rootCertificates, ...certificates] : undefined
}
