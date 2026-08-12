import * as React from "react"
import { useLocation } from "react-router"

import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"

export function ClientUserDirectoryRealtimeSync() {
  const location = useLocation()
  const { ready, subscribeRealtimeEvent } = useRealtime()
  const {
    invalidateUsers,
    refreshContacts,
    refreshFriendRequests,
    updateUserPresence,
    usersById = {},
  } = useClientData()
  const usersByIdRef = React.useRef(usersById)
  const friendRefreshPendingRef = React.useRef(false)
  const friendRefreshDirtyRef = React.useRef(false)
  const friendRefreshScheduledRef = React.useRef(false)
  const wasReadyRef = React.useRef(false)

  React.useEffect(() => {
    usersByIdRef.current = usersById
  }, [usersById])

  React.useEffect(() => {
    const unsubscribeProfile = subscribeRealtimeEvent("user.profile.updated", (payload) => {
      const update = readProfileUpdate(payload)
      if (update && usersByIdRef.current[update.userId]) {
        invalidateUsers?.([update.userId], update.updatedAt)
      }
    })
    const unsubscribePresence = subscribeRealtimeEvent("user.presence.updated", (payload) => {
      const update = readPresenceUpdate(payload)
      if (update) updateUserPresence?.(update.userId, update.online, update.lastOnlineAt)
    })
    return () => {
      unsubscribeProfile()
      unsubscribePresence()
    }
  }, [invalidateUsers, subscribeRealtimeEvent, updateUserPresence])

  React.useEffect(() => {
    const refreshVisibleContacts = () => {
      if (!location.pathname.startsWith("/contacts")) return
      if (friendRefreshPendingRef.current) {
        friendRefreshDirtyRef.current = true
        return
      }
      if (friendRefreshScheduledRef.current) return
      friendRefreshScheduledRef.current = true
      queueMicrotask(() => {
        friendRefreshScheduledRef.current = false
        friendRefreshPendingRef.current = true
        void (async () => {
          try {
            do {
              friendRefreshDirtyRef.current = false
              await Promise.allSettled([refreshContacts(), refreshFriendRequests?.()])
            } while (friendRefreshDirtyRef.current)
          } finally {
            friendRefreshPendingRef.current = false
          }
        })()
      })
    }
    const events = [
      ["friend.request.created", isFriendRequestEvent],
      ["friend.request.updated", isFriendRequestEvent],
      ["friendship.created", isFriendshipEvent],
      ["friendship.deleted", isFriendshipEvent],
      ["contact.directory.mode.updated", isDirectoryModeEvent],
    ] as const
    const unsubscribers = events.map(([eventName, isValid]) =>
      subscribeRealtimeEvent(eventName, (payload) => {
        if (isValid(payload)) refreshVisibleContacts()
      }),
    )
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [location.pathname, refreshContacts, refreshFriendRequests, subscribeRealtimeEvent])

  React.useEffect(() => {
    const becameReady = ready && !wasReadyRef.current
    wasReadyRef.current = ready
    if (becameReady) invalidateUsers?.(Object.keys(usersByIdRef.current))
  }, [invalidateUsers, ready])

  return null
}

function readProfileUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = payload as { updated_at?: unknown; user_id?: unknown }
  if (
    typeof value.user_id !== "string" ||
    !value.user_id.trim() ||
    typeof value.updated_at !== "string" ||
    Number.isNaN(Date.parse(value.updated_at))
  ) {
    return null
  }
  return { updatedAt: value.updated_at, userId: value.user_id }
}

function readPresenceUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = payload as { last_online_at?: unknown; online?: unknown; user_id?: unknown }
  if (
    typeof value.user_id !== "string" ||
    !value.user_id.trim() ||
    typeof value.online !== "boolean"
  ) {
    return null
  }
  if (
    value.last_online_at !== undefined &&
    (typeof value.last_online_at !== "string" || Number.isNaN(Date.parse(value.last_online_at)))
  ) {
    return null
  }
  return {
    lastOnlineAt: value.last_online_at,
    online: value.online,
    userId: value.user_id,
  }
}

function isFriendRequestEvent(payload: unknown) {
  return (
    isRealtimeRecord(payload) &&
    typeof payload.request_id === "string" &&
    Boolean(payload.request_id.trim())
  )
}

function isFriendshipEvent(payload: unknown) {
  return (
    isRealtimeRecord(payload) &&
    (payload.request_id === undefined || typeof payload.request_id === "string")
  )
}

function isDirectoryModeEvent(payload: unknown) {
  return (
    isRealtimeRecord(payload) && (payload.mode === "organization" || payload.mode === "friends")
  )
}

function isRealtimeRecord(payload: unknown): payload is Record<string, unknown> {
  return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload)
}
