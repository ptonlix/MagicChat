import { describe, expect, it, vi } from "vitest"
import {
  listClientConversations,
  listConversationTopics,
  updateGroupConversationAnnouncement,
} from "./conversations"
import { normalizeClientMessageBody, normalizeMessage } from "./message-normalizers"
import {
  formatClientMessageBodySummary,
  normalizeMessageCreatedEventPayload,
  normalizeMessageUpdatedEventPayload,
  sendConversationVoiceMessage,
  listConversationAttachments,
} from "./messages"

const baseMessage = {
  conversation_id: "conversation-1",
  created_at: "2026-07-31T00:00:00Z",
  id: "message-1",
  sender: { id: "user-1", type: "user" },
  seq: 1,
}

describe("upstream 聊天协议兼容", () => {
  it("归一化好友建立系统消息并保持系统摘要语义", () => {
    const body = normalizeClientMessageBody({
      event: "friendship_created",
      type: "system_event",
    })
    expect(body).toEqual({ event: "friendship_created", type: "system_event" })
    expect(formatClientMessageBodySummary(body)).toBe("你们已成为好友，现在可以开始聊天了")
  })

  it("拒绝错误的好友系统消息字段并保留未知事件降级", () => {
    expect(
      normalizeClientMessageBody({ event: "friendship_created", type: "text" } as never),
    ).toEqual({
      type: "unsupported",
    })
    expect(
      normalizeClientMessageBody({ event: "future_event", type: "system_event" } as never),
    ).toEqual({
      type: "unsupported",
    })
  })

  it("校验话题和历史附件分页响应", async () => {
    const conversation = {
      created_at: "2026-07-31T00:00:00Z",
      id: "topic-1",
      name: "话题一",
      type: "topic",
    }
    const topicFetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: { next_cursor: "next", topics: [conversation] } }),
      )
    await expect(
      listConversationTopics("conversation-1", { limit: 50 }, topicFetcher),
    ).resolves.toEqual({
      nextCursor: "next",
      topics: [expect.objectContaining({ id: "topic-1", type: "topic" })],
    })
    const attachmentFetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          attachments: [
            {
              created_at: "2026-07-31T00:00:00Z",
              file_id: "file-1",
              message_id: "message-1",
              name: "a.txt",
              seq: 1,
              size_bytes: 10,
            },
          ],
          next_cursor: null,
        },
      }),
    )
    await expect(
      listConversationAttachments("conversation-1", { limit: 50 }, attachmentFetcher),
    ).resolves.toMatchObject({
      attachments: [{ file: { fileId: "file-1", sizeBytes: 10 } }],
      nextCursor: null,
    })
    attachmentFetcher.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { attachments: [{ seq: -1 }] } }),
    )
    await expect(
      listConversationAttachments("conversation-1", {}, attachmentFetcher),
    ).rejects.toThrow("历史附件响应格式不正确")
  })

  it("旧 Server 缺少公告时归一化为空字符串", async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            conversations: [
              {
                created_at: "2026-07-31T00:00:00Z",
                id: "conversation-1",
                name: "群聊",
                type: "group",
              },
            ],
          },
          success: true,
        }),
      ),
    )

    await expect(listClientConversations(fetcher)).resolves.toMatchObject([
      { announcement: "", id: "conversation-1" },
    ])
  })

  it("更新群公告使用固定 PATCH 路径并采用 Server 返回状态", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          conversation: {
            announcement: "新的公告",
            created_at: "2026-07-31T00:00:00Z",
            id: "conversation-1",
            name: "群聊",
            type: "group",
          },
        },
        success: true,
      }),
    )

    await expect(
      updateGroupConversationAnnouncement("conversation-1", { announcement: "新的公告" }, fetcher),
    ).resolves.toMatchObject({ conversation: { announcement: "新的公告" }, message: null })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/groups/conversation-1/announcement",
      expect.objectContaining({
        body: JSON.stringify({ announcement: "新的公告" }),
        method: "PATCH",
      }),
    )
  })

  it("群公告更新保留 Server 错误信息", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: { code: "announcement_too_long", message: "群公告不能超过 200 个字符" },
          success: false,
        },
        400,
      ),
    )

    await expect(
      updateGroupConversationAnnouncement("conversation-1", { announcement: "过长" }, fetcher),
    ).rejects.toMatchObject({ code: "announcement_too_long", message: "群公告不能超过 200 个字符" })
  })

  it("只为合法文本和 Markdown 撤回正文保留重新编辑数据", () => {
    expect(
      normalizeMessage({
        ...baseMessage,
        editable_body: { content: "再次发送", type: "text" },
        revoked_at: "2026-07-31T00:01:00Z",
      }).body,
    ).toEqual({ editableBody: { content: "再次发送", type: "text" }, type: "revoked" })
    expect(
      normalizeMessage({
        ...baseMessage,
        editable_body: { content: "**再次发送**", type: "markdown" },
        revoked_at: "2026-07-31T00:01:00Z",
      }).body,
    ).toEqual({ editableBody: { content: "**再次发送**", type: "markdown" }, type: "revoked" })
    expect(
      normalizeMessage({
        ...baseMessage,
        editable_body: { content: 1, type: "text" } as never,
        revoked_at: "2026-07-31T00:01:00Z",
      }).body,
    ).toEqual({ type: "revoked" })
  })

  it("接受 WebM/M4A，拒绝未允许的音频类型，并统一语音摘要", () => {
    const voice = {
      content_type: "audio/mp4",
      duration_ms: 1_000,
      file_id: "voice-1",
      size_bytes: 1_024,
      transcript: "  明天见  ",
      type: "voice" as const,
    }
    const normalized = normalizeClientMessageBody(voice)
    expect(normalized).toMatchObject({ contentType: "audio/mp4", transcript: "明天见" })
    expect(formatClientMessageBodySummary(normalized)).toBe("[语音] 明天见")
    expect(normalizeClientMessageBody({ ...voice, content_type: "audio/webm" })).toMatchObject({
      contentType: "audio/webm",
    })
    expect(normalizeClientMessageBody({ ...voice, content_type: "audio/mpeg" })).toEqual({
      type: "unsupported",
    })
  })

  it("发送语音时去除转写首尾空白并省略空转写", async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            message: {
              ...baseMessage,
              body: {
                content_type: "audio/webm",
                duration_ms: 1_000,
                file_id: "voice-1",
                size_bytes: 3,
                transcript: "收到",
                type: "voice",
              },
            },
          },
          success: true,
        }),
      ),
    )
    const voice = new Blob(["abc"], { type: "audio/webm" })

    await sendConversationVoiceMessage(
      "conversation-1",
      { clientMessageId: "client-1", durationMS: 1_000, transcript: "  收到  ", voice },
      fetcher,
    )
    const firstBody = fetcher.mock.calls[0]?.[1]?.body as FormData
    expect(firstBody.get("transcript")).toBe("收到")

    await sendConversationVoiceMessage(
      "conversation-1",
      { clientMessageId: "client-2", durationMS: 1_000, transcript: "   ", voice },
      fetcher,
    )
    const secondBody = fetcher.mock.calls[1]?.[1]?.body as FormData
    expect(secondBody.has("transcript")).toBe(false)
  })

  it("发送语音时保留 Server 的转写长度错误", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: { code: "transcript_too_long", message: "语音转写不能超过 5000 个字符" },
          success: false,
        },
        400,
      ),
    )

    await expect(
      sendConversationVoiceMessage(
        "conversation-1",
        {
          clientMessageId: "client-1",
          durationMS: 1_000,
          transcript: "过长转写",
          voice: new Blob(["voice"], { type: "audio/webm" }),
        },
        fetcher,
      ),
    ).rejects.toMatchObject({
      code: "transcript_too_long",
      message: "语音转写不能超过 5000 个字符",
    })
  })

  it("归一化群公告更新事件并区分更新与清空摘要", () => {
    const updated = normalizeClientMessageBody({
      actor: { display_name: "张三", id: "user-1" },
      announcement: "新的公告",
      event: "group_announcement_updated",
      type: "system_event",
    })
    const cleared = normalizeClientMessageBody({
      actor: { display_name: "张三", id: "user-1" },
      announcement: "",
      event: "group_announcement_updated",
      type: "system_event",
    })
    expect(formatClientMessageBodySummary(updated)).toBe("张三 更新了群公告")
    expect(formatClientMessageBodySummary(cleared)).toBe("张三 清空了群公告")
  })

  it("历史、实时创建和实时更新复用新协议归一化", () => {
    const message = {
      ...baseMessage,
      body: {
        content_type: "audio/mp4",
        duration_ms: 1_000,
        file_id: "voice-1",
        size_bytes: 1_024,
        transcript: "收到",
        type: "voice" as const,
      },
    }
    expect(normalizeMessage(message).body).toEqual(
      normalizeMessageCreatedEventPayload({ message }).body,
    )
    expect(normalizeMessage(message).body).toEqual(
      normalizeMessageUpdatedEventPayload({ message }).body,
    )
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}
