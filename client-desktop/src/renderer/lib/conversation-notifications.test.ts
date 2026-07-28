import { describe, expect, it } from "vitest"

import { getNotifiableUnreadCount, getTotalUnreadCount } from "@/lib/conversation-notifications"
import type { ClientConversation } from "@/lib/client-data-api"

describe("getNotifiableUnreadCount", () => {
  it("只汇总未开启消息免打扰的未读消息", () => {
    expect(
      getNotifiableUnreadCount([
        conversation({ unreadCount: 3 }),
        conversation({ notificationMuted: true, unreadCount: 8 }),
      ]),
    ).toBe(3)
  })
})

describe("getTotalUnreadCount", () => {
  it("汇总所有会话的未读消息，包括免打扰会话", () => {
    expect(
      getTotalUnreadCount([
        conversation({ unreadCount: 3 }),
        conversation({ notificationMuted: true, unreadCount: 8 }),
      ]),
    ).toBe(11)
  })
})

function conversation(overrides: Partial<ClientConversation>): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-28T00:00:00Z",
    id: crypto.randomUUID(),
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    name: "会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
  }
}
