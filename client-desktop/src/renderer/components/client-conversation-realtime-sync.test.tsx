import { act, render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

const callbacks = new Map<string, (payload: unknown) => void>()
const updateConversationMuted = vi.fn()
const refreshConversations = vi.fn().mockResolvedValue(undefined)

vi.mock("@/lib/realtime-context", () => ({
  useRealtime: () => ({
    ready: true,
    subscribeRealtimeEvent: (event: string, callback: (payload: unknown) => void) => {
      callbacks.set(event, callback)
      return () => callbacks.delete(event)
    },
  }),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    foregroundConversationId: "",
    handleIncomingConversationMessage: vi.fn(),
    handleIncomingConversationMessageUpdate: vi.fn(),
    handleIncomingMessageReactionsUpdate: vi.fn(),
    refreshConversations,
    removeConversation: vi.fn(),
    syncLoadedConversationMessages: vi.fn(),
    updateConversationLastMentionedSeq: vi.fn(),
    updateConversationMuted,
    updateConversationPinned: vi.fn(),
    updateMessageTopic: vi.fn(),
  }),
}))

import { ClientConversationRealtimeSync } from "@/components/client-conversation-realtime-sync"

describe("ClientConversationRealtimeSync", () => {
  beforeEach(() => {
    callbacks.clear()
    refreshConversations.mockClear()
    updateConversationMuted.mockClear()
  })

  it("applies conversation mute realtime events", () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    act(() => {
      callbacks.get("conversation.mute_updated")?.({
        conversation_id: "conversation-1",
        muted: true,
      })
    })

    expect(updateConversationMuted).toHaveBeenCalledWith("conversation-1", true)
  })

  it("refreshes conversations for a valid restored event and ignores malformed payloads", async () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    act(() => {
      callbacks.get("conversation.restored")?.({ conversation_id: "conversation-2" })
      callbacks.get("conversation.restored")?.({ conversation_id: "" })
    })

    await waitFor(() => expect(refreshConversations).toHaveBeenCalledOnce())
  })
})
