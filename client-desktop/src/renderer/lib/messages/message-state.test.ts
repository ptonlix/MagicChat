import { describe, expect, it } from "vitest"
import type { ClientMessage } from "@/lib/client-data-api"
import { mergeManagedMessages, preserveNewerMessageState } from "./message-state"

describe("消息领域状态合并", () => {
  it("按 ID 去重、seq 排序并保护较新 reaction、choice 和 topic", () => {
    const current = createMessage("message-2", 2, {
      choice: { myOptionIds: ["a"], options: [], responseCount: 3 },
      reactionVersion: 4,
      reactions: [{ count: 1, reactedByMe: true, text: "ok", users: [] }],
      topic: { archived: false, conversationId: "topic-1", recentReplies: [] },
    })
    const stale = createMessage("message-2", 2, {
      choice: { myOptionIds: [], options: [], responseCount: 2 },
      reactionVersion: 2,
    })
    const merged = mergeManagedMessages([current], [createMessage("message-1", 1), stale])
    expect(merged.map((message) => message.id)).toEqual(["message-1", "message-2"])
    expect(merged[1]).toMatchObject({
      choice: { myOptionIds: ["a"], responseCount: 3 },
      reactionVersion: 4,
      topic: { conversationId: "topic-1" },
    })
  })

  it("撤回终态不会被旧活动 payload 复活", () => {
    const revoked = createMessage("message-1", 1, { body: { type: "revoked" } })
    expect(preserveNewerMessageState(revoked, createMessage("message-1", 1))).toBe(revoked)
  })
})

function createMessage(id: string, seq: number, patch: Partial<ClientMessage> = {}): ClientMessage {
  return {
    body: { content: id, type: "text" },
    clientMessageId: `client-${id}`,
    conversationId: "conversation-1",
    createdAt: "2026-07-29T00:00:00Z",
    id,
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-1", type: "user" },
    seq,
    ...patch,
  } as ClientMessage
}
