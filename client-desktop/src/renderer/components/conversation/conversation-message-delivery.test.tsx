import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MessageBubble } from "@/components/conversation/conversation-message"
import type { ClientConversation } from "@/lib/client-data-api"
import type { ConversationPanelMessage } from "@/lib/conversation-panel-types"

vi.mock("@/components/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({
        "message.retrySend": "Retry sending message",
        "message.retrySendTitle": "Message failed. Click to retry",
        "message.sending": "Sending message",
      })[key] ?? key,
  }),
}))

vi.mock("@/components/user-profile-popover", () => ({
  UserProfilePopover: ({ children }: { children: ReactNode }) => children,
}))

describe("MessageBubble delivery state", () => {
  it("shows a sending status", () => {
    renderBubble({ deliveryStatus: "sending" })

    expect(screen.getByLabelText("Sending message")).toBeInTheDocument()
  })

  it("keeps a retry action on a failed message", async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    renderBubble({ deliveryStatus: "failed", retry })

    await user.click(screen.getByRole("button", { name: "Retry sending message" }))
    expect(retry).toHaveBeenCalledOnce()
  })
})

function renderBubble(overrides: Partial<ConversationPanelMessage>) {
  const message: ConversationPanelMessage = {
    author: "Me",
    avatar: "",
    body: { content: "Optimistic message", type: "text" },
    canRevoke: false,
    createdAt: "2026-08-01T00:00:00Z",
    delegatedByName: "",
    id: "optimistic:client-1",
    mentionTarget: null,
    reactionVersion: 0,
    reactions: [],
    role: "me",
    senderAppId: null,
    senderAppProfile: null,
    senderUserId: "user-1",
    time: "08:00",
    ...overrides,
  }
  const conversation = {
    avatar: "",
    createdAt: "2026-08-01T00:00:00Z",
    id: "conversation-1",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    name: "Conversation",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
  } as ClientConversation

  return render(
    <MessageBubble
      conversation={conversation}
      currentUserId="user-1"
      mentionLabelResolver={() => undefined}
      message={message}
      onInsertMention={vi.fn()}
    />,
  )
}
