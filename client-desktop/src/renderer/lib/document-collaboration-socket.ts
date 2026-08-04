import { HocuspocusProviderWebsocket } from "@hocuspocus/provider"

import type { AuthenticatedTarget } from "@shared/client-contract"
import {
  DOCUMENT_COLLABORATION_LIMITS,
  type DocumentCollaborationEvent,
} from "@shared/document-collaboration-contract"

type SocketListener = (event: Event) => void

const MAX_PENDING_EVENT_COUNT = 256

export class DocumentCollaborationProviderWebsocket extends HocuspocusProviderWebsocket {
  override onClose(parameters: Parameters<HocuspocusProviderWebsocket["onClose"]>[0]): void {
    if (parameters.event.code === 4403) this.shouldConnect = false
    super.onClose(parameters)
  }
}

export class DocumentCollaborationSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  binaryType: BinaryType = "arraybuffer"
  readonly identifier = Math.random()
  readyState = DocumentCollaborationSocket.CONNECTING
  private readonly connectionId = crypto.randomUUID()
  private readonly listeners = new Map<string, Set<SocketListener>>()
  private readonly listenerWrappers = new Map<
    string,
    Map<EventListenerOrEventListenerObject, SocketListener>
  >()
  private sessionId?: string
  private unsubscribe?: () => void
  private closeRequested = false
  private readonly pendingEvents: DocumentCollaborationEvent[] = []
  private pendingEventBytes = 0

  constructor(
    _ignoredUrl: string,
    private readonly target: AuthenticatedTarget,
    private readonly documentId: string,
  ) {
    this.unsubscribe = window.desktop.documentCollaboration.subscribe((event) =>
      this.receive(event),
    )
    void window.desktop.documentCollaboration.connect(target, documentId, this.connectionId).then(
      ({ sessionId }) => {
        if (this.closeRequested) {
          void window.desktop.documentCollaboration.close(sessionId).catch(() => undefined)
          this.finishClose(1000, "closed")
          return
        }
        this.sessionId = sessionId
        const events = this.pendingEvents.splice(0)
        this.pendingEventBytes = 0
        for (const event of events) this.receive(event)
      },
      () => {
        if (this.closeRequested) {
          this.finishClose(1000, "closed")
          return
        }
        this.dispatch("error", new Event("error"))
        this.finishClose(1006, "connection_failed")
      },
    )
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const wrappers = this.listenerWrappers.get(type) ?? new Map()
    if (wrappers.has(listener)) return
    const callback: SocketListener =
      typeof listener === "function" ? listener : (event) => listener.handleEvent(event)
    wrappers.set(listener, callback)
    this.listenerWrappers.set(type, wrappers)
    const values = this.listeners.get(type) ?? new Set<SocketListener>()
    values.add(callback)
    this.listeners.set(type, values)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const wrappers = this.listenerWrappers.get(type)
    const callback = wrappers?.get(listener)
    if (!callback) return
    wrappers?.delete(listener)
    this.listeners.get(type)?.delete(callback)
    if (wrappers?.size === 0) this.listenerWrappers.delete(type)
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type)
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== DocumentCollaborationSocket.OPEN || !this.sessionId) {
      throw new DOMException("连接尚未建立", "InvalidStateError")
    }
    const frame = toUint8Array(data)
    void window.desktop.documentCollaboration.send(this.sessionId, frame).catch(() => {
      this.dispatch("error", new Event("error"))
    })
  }

  close(code = 1000, reason = "client closed"): void {
    if (this.readyState >= DocumentCollaborationSocket.CLOSING) return
    this.closeRequested = true
    this.readyState = DocumentCollaborationSocket.CLOSING
    if (!this.sessionId) {
      const finish = () => this.finishClose(code, reason)
      void window.desktop.documentCollaboration.cancel(this.connectionId).then(finish, finish)
      return
    }
    const sessionId = this.sessionId
    const finish = () => this.finishClose(code, reason)
    void window.desktop.documentCollaboration.close(sessionId).then(finish, finish)
  }

  private receive(event: DocumentCollaborationEvent): void {
    if (event.connectionId !== this.connectionId) return
    if (!this.sessionId) {
      const eventBytes = event.type === "message" ? event.data.byteLength : 0
      if (
        this.pendingEvents.length >= MAX_PENDING_EVENT_COUNT ||
        this.pendingEventBytes + eventBytes > DOCUMENT_COLLABORATION_LIMITS.maxQueueBytes
      ) {
        this.closeRequested = true
        this.dispatch("error", new Event("error"))
        this.finishClose(1009, "pending_event_limit")
        return
      }
      this.pendingEvents.push(event)
      this.pendingEventBytes += eventBytes
      return
    }
    if (event.sessionId !== this.sessionId || this.closeRequested) return
    if (event.type === "open") {
      this.readyState = DocumentCollaborationSocket.OPEN
      this.dispatch("open", new Event("open"))
    } else if (event.type === "message") {
      const copy = Uint8Array.from(event.data)
      this.dispatch(
        "message",
        new MessageEvent("message", {
          data: copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
        }),
      )
    } else if (event.type === "error") {
      this.dispatch("error", new Event("error"))
    } else {
      this.finishClose(event.code, event.reason)
    }
  }

  private finishClose(code: number, reason: string): void {
    if (this.readyState === DocumentCollaborationSocket.CLOSED) return
    this.readyState = DocumentCollaborationSocket.CLOSED
    this.pendingEvents.length = 0
    this.pendingEventBytes = 0
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.dispatch("close", new CloseEvent("close", { code, reason }))
    this.listeners.clear()
    this.listenerWrappers.clear()
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
}

export function createDocumentWebSocketPolyfill(
  target: AuthenticatedTarget,
  documentId: string,
): new (url: string) => DocumentCollaborationSocket {
  return class extends DocumentCollaborationSocket {
    constructor(url: string) {
      super(url, target, documentId)
    }
  }
}

function toUint8Array(data: string | ArrayBufferLike | Blob | ArrayBufferView): Uint8Array {
  if (typeof data === "string" || data instanceof Blob) {
    throw new TypeError("文档协作只接受二进制帧")
  }
  if (ArrayBuffer.isView(data)) {
    return Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }
  return Uint8Array.from(new Uint8Array(data))
}
