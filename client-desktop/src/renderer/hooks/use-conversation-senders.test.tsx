import { renderHook, waitFor } from "@testing-library/react"
import type { RefObject } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ClientDataRequestError } from "@/lib/client-data-api"
import { createConversationMessageState } from "@/lib/client-data-state"
import type { ClientConversationMessageState } from "@/lib/client-data-context"

const mocks = vi.hoisted(() => ({
  sendConversationCardMessage: vi.fn(),
  sendConversationEntityCardMessage: vi.fn(),
  sendConversationFileMessage: vi.fn(),
  sendConversationImageMessage: vi.fn(),
  sendConversationLinkMessage: vi.fn(),
  sendConversationMarkdownMessage: vi.fn(),
  sendConversationTextMessage: vi.fn(),
  sendConversationVoiceMessage: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/components/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-data-api")>()),
  sendConversationCardMessage: mocks.sendConversationCardMessage,
  sendConversationEntityCardMessage: mocks.sendConversationEntityCardMessage,
  sendConversationFileMessage: mocks.sendConversationFileMessage,
  sendConversationImageMessage: mocks.sendConversationImageMessage,
  sendConversationLinkMessage: mocks.sendConversationLinkMessage,
  sendConversationMarkdownMessage: mocks.sendConversationMarkdownMessage,
  sendConversationTextMessage: mocks.sendConversationTextMessage,
  sendConversationVoiceMessage: mocks.sendConversationVoiceMessage,
}))

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}))

import { useConversationSenders } from "@/hooks/use-conversation-senders"

describe("useConversationSenders", () => {
  beforeEach(() => {
    for (const sender of [
      mocks.sendConversationCardMessage,
      mocks.sendConversationEntityCardMessage,
      mocks.sendConversationFileMessage,
      mocks.sendConversationImageMessage,
      mocks.sendConversationLinkMessage,
      mocks.sendConversationMarkdownMessage,
      mocks.sendConversationTextMessage,
      mocks.sendConversationVoiceMessage,
    ]) {
      sender.mockReset()
      sender.mockRejectedValue(
        new ClientDataRequestError("仅支持向好友发送私信", {
          code: "direct_friendship_required",
          status: 403,
        }),
      )
    }
    mocks.toastError.mockReset()
  })

  it("在所有消息发送路径中展示服务端好友授权错误并恢复发送状态", async () => {
    const conversationId = "conversation-1"
    const conversationMessageStatesRef = {
      current: { [conversationId]: createConversationMessageState() },
    } as RefObject<Record<string, ClientConversationMessageState>>
    const mergeIncomingConversationMessage = vi.fn()
    const updateConversationMessageState = vi.fn(
      (
        id: string,
        updater: (state: ClientConversationMessageState) => ClientConversationMessageState,
      ) => {
        const current = conversationMessageStatesRef.current[id]
        conversationMessageStatesRef.current[id] = updater(current)
      },
    )
    const { result } = renderHook(() =>
      useConversationSenders({
        currentUserId: "user-1",
        conversationMessageStatesRef,
        mergeIncomingConversationMessage,
        updateConversationMessageState,
      }),
    )

    const operations = [
      () =>
        result.current.sendConversationText(conversationId, "文本", {
          replyToMessageId: "quoted-1",
        }),
      () =>
        result.current.sendConversationMarkdown(conversationId, "**富文本**", {
          replyToMessageId: "quoted-1",
        }),
      () =>
        result.current.sendConversationLink(conversationId, "https://example.com", {
          replyToMessageId: "quoted-1",
        }),
      () =>
        result.current.sendConversationCard(
          conversationId,
          { description: "描述", title: "标题", type: "card", url: "/projects/project-1" },
          { replyToMessageId: "quoted-1" },
        ),
      () =>
        result.current.sendConversationFile(
          conversationId,
          new File(["file"], "report.txt", { type: "text/plain" }),
          { replyToMessageId: "quoted-1" },
        ),
      () =>
        result.current.sendConversationImage(
          conversationId,
          new File(["image"], "photo.webp", { type: "image/webp" }),
          { replyToMessageId: "quoted-1" },
        ),
      () =>
        result.current.sendConversationVoice(
          conversationId,
          {
            blob: new Blob(["voice"], { type: "audio/webm" }),
            durationMS: 1_000,
            transcript: "语音",
          },
          { replyToMessageId: "quoted-1" },
        ),
    ]
    const outcomes = []
    for (const operation of operations) {
      outcomes.push(await operation())
    }

    expect(outcomes).toEqual([null, null, null, null, null, null, null])
    expect(mergeIncomingConversationMessage).toHaveBeenCalledTimes(6)
    expect(mergeIncomingConversationMessage.mock.calls[0]?.[0]).toMatchObject({
      deliveryStatus: "sending",
      sender: { id: "user-1", type: "user" },
    })
    expect(mergeIncomingConversationMessage.mock.calls[1]?.[0]).toMatchObject({
      deliveryStatus: "failed",
    })
    expect(mergeIncomingConversationMessage.mock.calls[1]?.[1]).toEqual({
      markLoaded: true,
      updateList: false,
    })
    expect(conversationMessageStatesRef.current[conversationId].sending).toBe(false)
    expect(mocks.toastError).toHaveBeenCalledTimes(7)
    expect(mocks.toastError).toHaveBeenCalledWith("仅支持向好友发送私信")
  })

  it("keeps the client message ID when retrying a failed optimistic text message", async () => {
    const conversationId = "conversation-1"
    const conversationMessageStatesRef = {
      current: { [conversationId]: createConversationMessageState() },
    } as RefObject<Record<string, ClientConversationMessageState>>
    const mergeIncomingConversationMessage = vi.fn()
    const updateConversationMessageState = vi.fn()
    const submittedIds: string[] = []
    mocks.sendConversationTextMessage.mockImplementation(
      async (_conversationId: string, input: { clientMessageId: string }) => {
        submittedIds.push(input.clientMessageId)
        if (submittedIds.length === 1) throw new Error("network timeout")
        return {
          body: { content: "文本", type: "text" },
          clientMessageId: input.clientMessageId,
          conversationId,
          createdAt: "2026-08-01T00:00:00Z",
          id: "message-1",
          reactionVersion: 0,
          reactions: [],
          sender: { id: "user-1", type: "user" },
          seq: 1,
        }
      },
    )
    const { result } = renderHook(() =>
      useConversationSenders({
        currentUserId: "user-1",
        conversationMessageStatesRef,
        mergeIncomingConversationMessage,
        updateConversationMessageState,
      }),
    )

    await expect(result.current.sendConversationText(conversationId, "文本")).resolves.toBeNull()
    const failedMessage = mergeIncomingConversationMessage.mock.calls.at(-1)?.[0]
    expect(failedMessage).toMatchObject({ deliveryStatus: "failed" })

    failedMessage.retry()
    await waitFor(() => expect(submittedIds).toHaveLength(2))

    expect(submittedIds[1]).toBe(submittedIds[0])
    expect(mergeIncomingConversationMessage.mock.calls.at(-2)?.[0]).toMatchObject({
      clientMessageId: submittedIds[0],
      deliveryStatus: "sending",
    })
    expect(mergeIncomingConversationMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      clientMessageId: submittedIds[0],
      id: "message-1",
    })
  })
})
