import * as React from "react"

import { normalizeMessageCreatedEventPayload } from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"

export function ClientConversationRealtimeSync() {
  const { ready: realtimeReady, subscribeRealtimeEvent } = useRealtime()
  const { mergeIncomingConversationMessage, syncLoadedConversationMessages } =
    useClientData()
  const previousRealtimeReadyRef = React.useRef(realtimeReady)

  React.useEffect(() => {
    return subscribeRealtimeEvent("message.created", (payload) => {
      try {
        mergeIncomingConversationMessage(
          normalizeMessageCreatedEventPayload(payload)
        )
      } catch {
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [mergeIncomingConversationMessage, subscribeRealtimeEvent])

  React.useEffect(() => {
    const wasReady = previousRealtimeReadyRef.current
    previousRealtimeReadyRef.current = realtimeReady

    if (!realtimeReady || wasReady) {
      return
    }

    syncLoadedConversationMessages()
  }, [realtimeReady, syncLoadedConversationMessages])

  return null
}
