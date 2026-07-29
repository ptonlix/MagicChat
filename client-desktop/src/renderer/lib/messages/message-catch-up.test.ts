import { describe, expect, it, vi } from "vitest"
import type { ClientMessage, ClientMessagePage } from "@/lib/client-data-api"
import {
  catchUpConversationMessages,
  MessageCatchUpError,
  MessageSyncSingleFlight,
  prioritizeConversationSyncs,
} from "./message-catch-up"

describe("消息连续追赶", () => {
  it("消费超过 20 条的全部页面并每十页让出事件循环", async () => {
    vi.useFakeTimers()
    const cursors: number[] = []
    const operation = catchUpConversationMessages({
      afterSeq: 0,
      conversationId: "conversation-1",
      fetchPage: async (cursor) => page(cursor + 1, cursor < 20),
      commit: async (result, cursor) => {
        cursors.push(cursor)
        return result.messages.at(-1)?.seq ?? cursor
      },
      yieldEveryPages: 10,
    })
    await vi.runAllTimersAsync()
    await expect(operation).resolves.toBe(21)
    expect(cursors).toHaveLength(21)
    vi.useRealTimers()
  })

  it("拒绝空页仍声明有后续以及错误会话", async () => {
    await expect(
      catchUpConversationMessages({
        afterSeq: 10,
        conversationId: "conversation-1",
        fetchPage: async () => ({ messages: [], page: messagePage(true) }),
        commit: async (_result, cursor) => cursor,
      }),
    ).rejects.toMatchObject({ code: "protocol_cursor" })

    await expect(
      catchUpConversationMessages({
        afterSeq: 10,
        conversationId: "conversation-1",
        fetchPage: async () => page(11, false, "conversation-2"),
        commit: async (_result, cursor) => cursor,
      }),
    ).rejects.toBeInstanceOf(MessageCatchUpError)
  })

  it("中间页失败时只保留最后提交游标", async () => {
    let committed = 10
    await expect(
      catchUpConversationMessages({
        afterSeq: committed,
        conversationId: "conversation-1",
        fetchPage: async (cursor) => {
          if (cursor === 11) throw new Error("network")
          return page(11, true)
        },
        commit: async (result) => {
          committed = result.messages[0].seq
          return committed
        },
      }),
    ).rejects.toMatchObject({ code: "network" })
    expect(committed).toBe(11)
  })

  it("同一会话复用单飞 Promise 并按当前、未读、最近顺序调度", async () => {
    const singleFlight = new MessageSyncSingleFlight()
    const operation = vi.fn(async () => 12)
    const first = singleFlight.run("scope:conversation-1", operation)
    const second = singleFlight.run("scope:conversation-1", operation)
    expect(first).toBe(second)
    await expect(first).resolves.toBe(12)
    expect(operation).toHaveBeenCalledTimes(1)

    expect(
      prioritizeConversationSyncs(
        [
          { id: "old", lastMessageAt: "2026-01-01", unreadCount: 0 },
          { id: "current", lastMessageAt: "2026-01-02", unreadCount: 0 },
          { id: "unread", lastMessageAt: "2026-01-03", unreadCount: 2 },
          { id: "recent", lastMessageAt: "2026-01-04", unreadCount: 0 },
        ],
        "current",
      ).map((item) => item.id),
    ).toEqual(["current", "unread", "recent", "old"])
  })
})

function page(seq: number, hasMoreAfter: boolean, conversationId = "conversation-1") {
  return { messages: [message(seq, conversationId)], page: messagePage(hasMoreAfter) }
}

function message(seq: number, conversationId: string): ClientMessage {
  return {
    body: { content: String(seq), type: "text" },
    clientMessageId: `client-${seq}`,
    conversationId,
    createdAt: "2026-07-29T00:00:00Z",
    id: `message-${seq}`,
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-1", type: "user" },
    seq,
  }
}

function messagePage(hasMoreAfter: boolean): ClientMessagePage {
  return {
    hasMoreAfter,
    hasMoreBefore: true,
    limit: 20,
    newestSeq: 0,
    oldestSeq: 0,
  }
}
