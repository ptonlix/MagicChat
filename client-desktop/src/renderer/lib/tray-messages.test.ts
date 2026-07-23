import { describe, expect, it } from "vitest"

import type { ClientConversation } from "@/lib/client-data-api"
import { selectLatestTrayMessages } from "@/lib/tray-messages"

describe("selectLatestTrayMessages", () => {
  it("按最新消息时间排序并最多返回五条", () => {
    const conversations = Array.from({ length: 7 }, (_, index) =>
      conversation(`conversation-${index}`, `2026-07-23T0${index}:00:00Z`),
    )

    expect(selectLatestTrayMessages(conversations).map((item) => item.conversationId)).toEqual([
      "conversation-6",
      "conversation-5",
      "conversation-4",
      "conversation-3",
      "conversation-2",
    ])
  })

  it("忽略没有消息的会话并压缩换行", () => {
    const empty = conversation("empty", null)
    const latest = conversation("latest", "2026-07-23T08:00:00Z")
    latest.name = " 产品\n讨论组 "
    latest.lastMessageSummary = "   "
    latest.unreadCount = 3

    expect(selectLatestTrayMessages([empty, latest])).toEqual([
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

    const [message] = selectLatestTrayMessages([latest])

    expect(message.name).toBe("会话名称会话名称会话名称会话名…")
    expect(Array.from(message.name)).toHaveLength(16)
    expect(message.summary).toBe("最新消息最新消息最新消息最新消息最新消息最新消…")
    expect(Array.from(message.summary)).toHaveLength(24)
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
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    name: id,
    type: "direct",
    unreadCount: 0,
    visibility: "private",
  }
}
