import { describe, expect, it } from "vitest"

import type { ClientConversation, ClientMessage } from "@/lib/client-data-api"
import {
  applyMessageChoiceSnapshot,
  consumeConversationMessageFocus,
  mergeConversationMessages,
  orderConversations,
} from "@/lib/client-data-state"
import type { ClientConversationMessageState } from "@/lib/client-data-context"

describe("consumeConversationMessageFocus", () => {
  it("仅消费完全匹配的定位请求", () => {
    const focus = { messageId: "message-1", requestKey: 2 }
    const state = { focus } as ClientConversationMessageState

    expect(consumeConversationMessageFocus(state, { messageId: "message-1", requestKey: 1 })).toBe(
      state,
    )
    expect(consumeConversationMessageFocus(state, { messageId: "message-2", requestKey: 2 })).toBe(
      state,
    )
    expect(consumeConversationMessageFocus(state, focus)).toEqual({ focus: null })
  })
})

describe("applyMessageChoiceSnapshot", () => {
  it("does not apply a snapshot when the choice changed after the request started", () => {
    const expectedChoice = {
      myOptionIds: ["option-a"],
      options: [
        { id: "option-a", responseCount: 1 },
        { id: "option-b", responseCount: 0 },
      ],
      responseCount: 1,
    }
    const currentChoice = {
      myOptionIds: ["option-b"],
      options: [
        { id: "option-a", responseCount: 0 },
        { id: "option-b", responseCount: 1 },
      ],
      responseCount: 1,
    }
    const message: ClientMessage = {
      ...createMessage("message-choice", 1),
      body: {
        content: "选择项目",
        contentType: "text",
        options: [
          { id: "option-a", label: "项目 A" },
          { id: "option-b", label: "项目 B" },
        ],
        selection: "single",
        type: "choice",
      },
      choice: currentChoice,
    }

    expect(
      applyMessageChoiceSnapshot(
        message,
        {
          choice: expectedChoice,
          conversationId: message.conversationId,
          messageId: message.id,
          status: "active",
        },
        { expectedChoice },
      ),
    ).toBe(message)
  })
})

describe("mergeConversationMessages", () => {
  it("appends newer messages in sequence order", () => {
    const current = [createMessage("message-1", 1)]
    const next = [createMessage("message-3", 3), createMessage("message-2", 2)]

    expect(mergeConversationMessages(current, next).map(({ id }) => id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ])
  })

  it("prepends an older page in sequence order", () => {
    const current = [createMessage("message-3", 3), createMessage("message-4", 4)]
    const next = [createMessage("message-2", 2), createMessage("message-1", 1)]

    expect(mergeConversationMessages(current, next).map(({ id }) => id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
    ])
  })

  it("replaces an existing message with its newest representation", () => {
    const current = [createMessage("message-1", 1, "旧内容")]
    const updated = createMessage("message-1", 1, "新内容")

    expect(mergeConversationMessages(current, [updated])).toEqual([updated])
  })

  it("deduplicates messages within an incoming page", () => {
    const first = createMessage("message-1", 1, "旧内容")
    const latest = createMessage("message-1", 1, "新内容")

    expect(mergeConversationMessages([], [first, latest])).toEqual([latest])
  })

  it("replaces an optimistic message with a realtime or HTTP response sharing its client ID", () => {
    const optimistic = {
      ...createMessage("optimistic:client-1", 2),
      clientMessageId: "client-1",
      deliveryStatus: "sending" as const,
    }
    const persisted = {
      ...createMessage("message-2", 18),
      clientMessageId: "client-1",
    }
    const lateFailure = { ...optimistic, deliveryStatus: "failed" as const }

    expect(mergeConversationMessages([optimistic], [persisted, lateFailure])).toEqual([persisted])
  })

  it("falls back to a full merge for overlapping sequence ranges", () => {
    const current = [createMessage("message-1", 1), createMessage("message-3", 3)]
    const next = [createMessage("message-4", 4), createMessage("message-2", 2)]

    expect(mergeConversationMessages(current, next).map(({ id }) => id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
    ])
  })

  it("uses creation time to order messages with the same sequence", () => {
    const later = createMessage("message-2", 1, "", "2026-07-14T10:01:00Z")
    const earlier = createMessage("message-1", 1, "", "2026-07-14T10:00:00Z")

    expect(mergeConversationMessages([later], [earlier]).map(({ id }) => id)).toEqual([
      "message-1",
      "message-2",
    ])
  })
})

describe("orderConversations", () => {
  it("pins only the built-in assistant and orders every other conversation by activity", () => {
    const assistant = createConversation("assistant", "app", "2026-07-01", [
      createAppMember("00000000-0000-0000-0000-000000000001"),
    ])
    const regularApp = createConversation("regular-app", "app", "2026-07-18")
    const activeGroup = createConversation("active-group", "group", "2026-07-20")
    const direct = createConversation("direct", "direct", "2026-07-19")

    expect(
      orderConversations([regularApp, assistant, direct, activeGroup]).map(({ id }) => id),
    ).toEqual(["assistant", "active-group", "direct", "regular-app"])
  })

  it("does not pin a group that contains the built-in assistant", () => {
    const recentApp = createConversation("recent-app", "app", "2026-07-20")
    const oldGroup = createConversation("old-group", "group", "2026-07-01", [
      createAppMember("00000000-0000-0000-0000-000000000001"),
    ])

    expect(orderConversations([oldGroup, recentApp]).map(({ id }) => id)).toEqual([
      "recent-app",
      "old-group",
    ])
  })

  it("orders pinned conversations by activity ahead of unpinned conversations", () => {
    const assistant = createConversation("assistant", "app", "2026-07-01", [
      createAppMember("00000000-0000-0000-0000-000000000001"),
    ])
    const olderPinned = {
      ...createConversation("older-pinned", "group", "2026-07-18"),
      pinned: true,
    }
    const recentPinned = {
      ...createConversation("recent-pinned", "direct", "2026-07-19"),
      pinned: true,
    }
    const newestUnpinned = createConversation("newest-unpinned", "group", "2026-07-20")

    expect(
      orderConversations([newestUnpinned, olderPinned, assistant, recentPinned]).map(
        ({ id }) => id,
      ),
    ).toEqual(["assistant", "recent-pinned", "older-pinned", "newest-unpinned"])
  })
})

function createMessage(
  id: string,
  seq: number,
  content = id,
  createdAt = `2026-07-14T10:00:${String(seq).padStart(2, "0")}Z`,
): ClientMessage {
  return {
    body: { content, type: "text" },
    clientMessageId: `client-${id}`,
    conversationId: "conversation-1",
    createdAt,
    id,
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-1", type: "user" },
    seq,
  }
}

function createConversation(
  id: string,
  type: ClientConversation["type"],
  activityDate: string,
  members?: ClientConversation["members"],
): ClientConversation {
  return {
    avatar: "",
    createdAt: `${activityDate}T08:00:00Z`,
    id,
    lastMessageAt: `${activityDate}T09:00:00Z`,
    lastMessageId: `message-${id}`,
    lastMessageSeq: 1,
    lastMessageSummary: id,
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 1,
    memberCount: members?.length ?? 2,
    members,
    name: id,
    type,
    unreadCount: 0,
    visibility: "private",
  }
}

function createAppMember(id: string) {
  return {
    avatar: "",
    email: "",
    id,
    name: "App",
    nickname: "",
    phone: "",
    role: "member" as const,
    type: "app" as const,
  }
}
