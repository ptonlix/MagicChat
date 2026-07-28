import { useCallback, useRef } from "react"

import type { ClientConversationMessageState } from "@/lib/client-data-context"
import { compactConversationMessageState } from "@/lib/client-data-state"

export function useConversationMessageRetention() {
  const viewTokensRef = useRef<Map<string, Set<symbol>>>(new Map())

  const registerConversationMessageView = useCallback((conversationId: string) => {
    if (!conversationId) {
      return () => undefined
    }

    const token = Symbol(conversationId)
    const tokens = viewTokensRef.current.get(conversationId) ?? new Set<symbol>()
    tokens.add(token)
    viewTokensRef.current.set(conversationId, tokens)

    return () => {
      const currentTokens = viewTokensRef.current.get(conversationId)
      if (!currentTokens) return
      currentTokens.delete(token)
      if (currentTokens.size === 0) viewTokensRef.current.delete(conversationId)
    }
  }, [])

  const applyConversationMessageRetention = useCallback(
    (conversationId: string, state: ClientConversationMessageState) =>
      viewTokensRef.current.has(conversationId) ? state : compactConversationMessageState(state),
    [],
  )

  return { applyConversationMessageRetention, registerConversationMessageView }
}
