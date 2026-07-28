import { describe, expect, it } from "vitest"

import type { ClientConversation } from "@/lib/client-data-api"
import { selectUnreadTrayMessages } from "@/lib/tray-messages"
import { MAX_TRAY_MESSAGES } from "@shared/bridge"

describe("selectUnreadTrayMessages", () => {
  it("按最新消息时间返回全部非免打扰未读会话", () => {
    const conversations = Array.from({ length: 8 }, (_, index) =>
      conversation(`conversation-${index}`, `2026-07-23T0${index}:00:00Z`),
    )
    conversations[7].notificationMuted = true

    expect(selectUnreadTrayMessages(conversations).map((item) => item.conversationId)).toEqual([
      "conversation-6",
      "conversation-5",
      "conversation-4",
      "conversation-3",
      "conversation-2",
      "conversation-1",
      "conversation-0",
    ])
  })

  it("忽略消息免打扰会话", () => {
    const muted = conversation("muted", "2026-07-23T09:00:00Z")
    muted.notificationMuted = true
    muted.unreadCount = 8
    const ordinary = conversation("ordinary", "2026-07-23T08:00:00Z")

    expect(selectUnreadTrayMessages([muted, ordinary]).map((item) => item.conversationId)).toEqual([
      "ordinary",
    ])
  })

  it("忽略没有未读消息的会话并压缩换行", () => {
    const empty = conversation("empty", null)
    const read = conversation("read", "2026-07-23T09:00:00Z")
    read.unreadCount = 0
    const latest = conversation("latest", "2026-07-23T08:00:00Z")
    latest.name = " 产品\n讨论组 "
    latest.lastMessageSummary = "   "
    latest.unreadCount = 3

    expect(selectUnreadTrayMessages([empty, read, latest])).toEqual([
      {
        conversationId: "latest",
        name: "产品 讨论组",
        summary: "新消息",
        unreadCount: 3,
      },
    ])
  })

  it("将会话名和消息摘要截断为固定展示长度", () => {
    const latest = conversation("latest", "2026-07-23T08:00:00Z")
    latest.name = "会话名称".repeat(10)
    latest.lastMessageSummary = "最新消息".repeat(10)

    const [message] = selectUnreadTrayMessages([latest])

    expect(message.name).toBe("会话名称会话名称会话名称会话名…")
    expect(Array.from(message.name)).toHaveLength(16)
    expect(message.summary).toBe("最新消息最新消息最新消息最新消息最新消息最新消…")
    expect(Array.from(message.summary)).toHaveLength(24)
  })

  it("只返回最新的固定数量会话", () => {
    const conversations = Array.from({ length: MAX_TRAY_MESSAGES + 5 }, (_, index) =>
      conversation(
        `conversation-${index}`,
        `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      ),
    )

    expect(selectUnreadTrayMessages(conversations)).toHaveLength(MAX_TRAY_MESSAGES)
    expect(selectUnreadTrayMessages(conversations)[0].conversationId).toBe(
      `conversation-${MAX_TRAY_MESSAGES + 4}`,
    )
  })
})

function conversation(id: string, lastMessageAt: string | null): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-23T00:00:00Z",
    id,
    lastMessageAt,
    lastMessageId: lastMessageAt ? `${id}-message` : null,
    lastMessageSeq: lastMessageAt ? 1 : 0,
    lastMessageSummary: `消息 ${id}`,
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    name: id,
    type: "direct",
    unreadCount: lastMessageAt ? 1 : 0,
    visibility: "private",
  }
}
