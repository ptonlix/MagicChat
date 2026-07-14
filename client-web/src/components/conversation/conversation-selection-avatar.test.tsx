import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConversationSelectionAvatar } from "@/components/conversation/conversation-selection-avatar"
import type { ClientConversation } from "@/lib/client-data-api"

describe("ConversationSelectionAvatar", () => {
  it("uses member tiles as a group avatar fallback", () => {
    render(
      <ConversationSelectionAvatar conversation={createGroupConversation()} />
    )

    expect(screen.getByLabelText("设计群")).toHaveTextContent("ABCD")
  })
})

function createGroupConversation(): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-14T08:00:00Z",
    id: "conversation-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "",
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 4,
    members: ["Alice", "Bob", "Carol", "David"].map((name, index) => ({
      avatar: "",
      email: "",
      id: `user-${index + 1}`,
      name,
      nickname: "",
      phone: "",
      role: index === 0 ? "owner" : "member",
      type: "user",
    })),
    name: "设计群",
    type: "group",
    unreadCount: 0,
    visibility: "private",
  }
}
