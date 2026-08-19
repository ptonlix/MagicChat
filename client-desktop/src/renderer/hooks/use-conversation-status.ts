import * as React from "react"

import { normalizeMessageCreatedEventPayload } from "@/lib/client-data-api"
import { recordRealtimeParseFailure } from "@/lib/desktop-diagnostics"
import { useRealtime } from "@/lib/realtime-context"

const STATUS_TTL_MS = 5_000
const STATUS_HEARTBEAT_MS = 3_000
const MAX_ACTIVE_STATUSES = 100
const MAX_SENDER_ID_LENGTH = 200
const MAX_STATUS_LENGTH = 32
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type StatusSender = Readonly<{ id: string; type: "app" | "user" }>
type ConversationStatus = Readonly<{ status: string; sender: StatusSender }>
type ConversationStatuses = Readonly<Record<string, ConversationStatus>>

function createConversationStatusStore() {
  let snapshot: ConversationStatuses = {}
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    replace(next: ConversationStatuses) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function readBoundedText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && Array.from(text).length <= maximumLength ? text : null
}

function readStatus(payload: unknown): Readonly<{
  conversationId: string
  sender: StatusSender
  status: string
}> | null {
  if (!payload || typeof payload !== "object") return null
  const value = payload as Record<string, unknown>
  const senderValue = value.sender
  if (!senderValue || typeof senderValue !== "object") return null
  const sender = senderValue as Record<string, unknown>
  const conversationId = readBoundedText(value.conversation_id, 36)
  const status = readBoundedText(value.status, MAX_STATUS_LENGTH)
  const senderId = readBoundedText(sender.id, MAX_SENDER_ID_LENGTH)
  const senderType = sender.type

  if (
    !conversationId ||
    !UUID_PATTERN.test(conversationId) ||
    !status ||
    !senderId ||
    (senderType !== "app" && senderType !== "user")
  ) {
    return null
  }

  return {
    conversationId,
    status,
    sender: { id: senderId, type: senderType },
  }
}

export function useConversationStatus({
  conversationId,
  supported,
}: {
  conversationId: string
  supported: boolean
}) {
  const { ready, sendRealtimeRequest, subscribeRealtimeEvent } = useRealtime()
  const [statusStore] = React.useState(createConversationStatusStore)
  const statuses = React.useSyncExternalStore(
    statusStore.subscribe,
    statusStore.getSnapshot,
    statusStore.getSnapshot,
  )
  const expiryTimersRef = React.useRef(new Map<string, number>())
  const focusedRef = React.useRef(false)
  const heartbeatRef = React.useRef<number | null>(null)

  const clearStatus = React.useCallback(
    (id: string) => {
      const timer = expiryTimersRef.current.get(id)
      if (timer !== undefined) window.clearTimeout(timer)
      expiryTimersRef.current.delete(id)
      const current = statusStore.getSnapshot()
      if (!(id in current)) return
      const next = { ...current }
      delete next[id]
      statusStore.replace(next)
    },
    [statusStore],
  )

  React.useEffect(() => {
    const unsubscribeStatus = subscribeRealtimeEvent("conversation.status", (payload) => {
      const event = readStatus(payload)
      if (!event) {
        recordRealtimeParseFailure()
        return
      }
      const expiryTimers = expiryTimersRef.current
      const oldTimer = expiryTimers.get(event.conversationId)
      const nextStatuses = { ...statusStore.getSnapshot() }
      if (oldTimer !== undefined) window.clearTimeout(oldTimer)
      expiryTimers.delete(event.conversationId)

      if (oldTimer === undefined && expiryTimers.size >= MAX_ACTIVE_STATUSES) {
        const oldestConversationId = expiryTimers.keys().next().value
        if (oldestConversationId !== undefined) {
          const oldestTimer = expiryTimers.get(oldestConversationId)
          if (oldestTimer !== undefined) window.clearTimeout(oldestTimer)
          expiryTimers.delete(oldestConversationId)
          delete nextStatuses[oldestConversationId]
        }
      }

      nextStatuses[event.conversationId] = {
        status: event.status,
        sender: event.sender,
      }
      statusStore.replace(nextStatuses)
      expiryTimers.set(
        event.conversationId,
        window.setTimeout(() => clearStatus(event.conversationId), STATUS_TTL_MS),
      )
    })
    const unsubscribeMessage = subscribeRealtimeEvent("message.created", (payload) => {
      try {
        const message = normalizeMessageCreatedEventPayload(payload)
        const current = statusStore.getSnapshot()[message.conversationId]
        if (
          current &&
          current.sender.id === message.sender.id &&
          current.sender.type === message.sender.type
        ) {
          clearStatus(message.conversationId)
        }
      } catch {
        recordRealtimeParseFailure()
        // 记录并忽略格式不合法的实时事件，避免污染当前会话状态。
      }
    })

    return () => {
      unsubscribeStatus()
      unsubscribeMessage()
    }
  }, [clearStatus, statusStore, subscribeRealtimeEvent])

  const stopHeartbeat = React.useCallback(() => {
    if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current)
    heartbeatRef.current = null
  }, [])

  const sendStatus = React.useCallback(() => {
    if (!supported || !conversationId || !ready || document.visibilityState !== "visible") return
    void sendRealtimeRequest("conversation.status", {
      conversation_id: conversationId,
      status: "正在输入",
    }).catch(() => undefined)
  }, [conversationId, ready, sendRealtimeRequest, supported])
  const sendStatusRef = React.useRef(sendStatus)
  React.useLayoutEffect(() => {
    sendStatusRef.current = sendStatus
  }, [sendStatus])

  const startHeartbeat = React.useCallback(() => {
    stopHeartbeat()
    if (!focusedRef.current || !ready || !supported || document.visibilityState !== "visible") {
      return
    }
    sendStatusRef.current()
    heartbeatRef.current = window.setInterval(() => sendStatusRef.current(), STATUS_HEARTBEAT_MS)
  }, [ready, stopHeartbeat, supported])

  React.useLayoutEffect(() => {
    focusedRef.current = false
    stopHeartbeat()
  }, [conversationId, stopHeartbeat, supported])

  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startHeartbeat()
      else stopHeartbeat()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [startHeartbeat, stopHeartbeat])

  React.useEffect(() => {
    if (!ready) {
      statusStore.replace({})
      expiryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      expiryTimersRef.current.clear()
      stopHeartbeat()
    } else if (focusedRef.current) {
      startHeartbeat()
    }
  }, [ready, startHeartbeat, statusStore, stopHeartbeat])

  React.useEffect(
    () => () => {
      stopHeartbeat()
      expiryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      expiryTimersRef.current.clear()
    },
    [stopHeartbeat],
  )

  return {
    status: supported && ready ? statuses[conversationId]?.status : undefined,
    onFocus: React.useCallback(() => {
      focusedRef.current = true
      startHeartbeat()
    }, [startHeartbeat]),
    onBlur: React.useCallback(() => {
      focusedRef.current = false
      stopHeartbeat()
    }, [stopHeartbeat]),
  }
}
