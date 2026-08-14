import { renderHook } from "@testing-library/react"
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
    expect(mergeIncomingConversationMessage).not.toHaveBeenCalled()
    expect(conversationMessageStatesRef.current[conversationId].sending).toBe(false)
    expect(mocks.toastError).toHaveBeenCalledTimes(7)
    expect(mocks.toastError).toHaveBeenCalledWith("仅支持向好友发送私信")
  })
})
