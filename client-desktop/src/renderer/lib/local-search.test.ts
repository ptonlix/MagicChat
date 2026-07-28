import { describe, expect, it } from "vitest"

import type { ClientConversation, ContactUser } from "@/lib/client-data-api"
import { createLocalSearchService } from "@/lib/local-search"

describe("local search service", () => {
  it("returns no content for an empty keyword", () => {
    expect(createService().search({ keyword: "  ", scope: "all" })).toEqual({
      conversations: [],
      directory: [],
    })
  })

  it("searches directory and conversations by pinyin initials", () => {
    const service = createService()
    expect(
      service.search({ keyword: "lxm", scope: "directory" }).directory.map(({ id }) => id),
    ).toEqual(["contact-1"])
    expect(
      service
        .search({ keyword: "cptl", scope: "conversation" })
        .conversations.map(({ conversation }) => conversation.id),
    ).toEqual(["conversation-1"])
  })

  it("respects the selected scope", () => {
    const service = createService({
      contact: createContact({ name: "产品联系人" }),
      conversation: createConversation({ name: "产品对话" }),
    })
    expect(service.search({ keyword: "产品", scope: "all" }).directory).toHaveLength(1)
    expect(service.search({ keyword: "产品", scope: "all" }).conversations).toHaveLength(1)
    expect(service.search({ keyword: "产品", scope: "directory" }).conversations).toHaveLength(0)
  })
})

function createService({
  contact = createContact(),
  conversation = createConversation(),
}: {
  contact?: ContactUser
  conversation?: ClientConversation
} = {}) {
  return createLocalSearchService({
    apps: [],
    contacts: [contact],
    conversations: [conversation],
    currentUserId: "current-user",
    groups: [],
  })
}

function createContact(overrides: Partial<ContactUser> = {}): ContactUser {
  return {
    avatar: "",
    email: "contact@example.com",
    id: "contact-1",
    lastOnlineAt: null,
    name: "李小明",
    nickname: "",
    online: true,
    phone: "",
    type: "user",
    ...overrides,
  }
}

function createConversation(overrides: Partial<ClientConversation> = {}): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-01T00:00:00Z",
    id: "conversation-1",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSender: null,
    lastMessageSeq: 0,
    lastMessageSummary: "",
    lastReadSeq: 0,
    memberCount: 0,
    members: [],
    name: "产品讨论",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
  }
}
