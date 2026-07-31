import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ScreenshotConversationResult } from "@shared/screenshot-contract"
import type { ClientConversation } from "@/lib/client-data-api"

const mocks = vi.hoisted(() => ({
  compressImage: vi.fn(async (file: File) => file),
  screenshotStart: vi.fn(),
  screenshotSubscriber: undefined as ((result: ScreenshotConversationResult) => void) | undefined,
  toastError: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }))
vi.mock("@/lib/image-message", () => ({
  compressImageForMessage: mocks.compressImage,
  imageMessageMaxBytes: 2 * 1024 * 1024,
  isAcceptedImageMessageFile: (file: File) => file.type.startsWith("image/"),
}))
vi.mock("@/components/expression-picker-popover", () => ({
  ExpressionPickerPopover: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/components/send-image-message-dialog", () => ({
  SendImageMessageDialog: ({ image, open }: { image: File | null; open: boolean }) =>
    open ? <div role="dialog">{image?.name}</div> : null,
}))
vi.mock("@/components/send-file-message-dialog", () => ({
  SendFileMessageDialog: () => null,
}))
vi.mock("@/components/conversation/send-voice-message-dialog", () => ({
  SendVoiceMessageDialog: () => null,
}))
vi.mock("@/components/conversation/smart-voice-input-dialog", () => ({
  SmartVoiceInputDialog: () => null,
}))
vi.mock("@/components/conversation/conversation-voice-menu", () => ({
  ConversationVoiceMenu: () => null,
}))

import { ConversationPanelComposer } from "./conversation-panel-composer"

describe("ConversationPanelComposer 截图", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.screenshotSubscriber = undefined
    mocks.screenshotStart.mockResolvedValue({ sessionId: "session-1", status: "started" })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        screenshot: {
          start: mocks.screenshotStart,
          subscribeCompleted: (listener: (result: ScreenshotConversationResult) => void) => {
            mocks.screenshotSubscriber = listener
            return mocks.unsubscribe
          },
        },
      },
    })
  })

  it("以当前对话启动截图，并把匹配的 PNG 接入图片准备流程", async () => {
    const user = userEvent.setup()
    const resultBlob = new Blob([new Uint8Array([1])], { type: "image/png" })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ blob: async () => resultBlob, ok: true } as Response)
    const { unmount } = renderComposer()

    await user.click(screen.getByRole("button", { name: "截取屏幕" }))

    expect(mocks.screenshotStart).toHaveBeenCalledWith({ conversationId: "conversation-1" })
    expect(mocks.screenshotSubscriber).toBeTypeOf("function")

    act(() => {
      mocks.screenshotSubscriber?.({
        conversationId: "conversation-other",
        fileName: "ignored.png",
        resourceUrl: "magicchat-capture://result/session/ignored",
        sessionId: "session-other",
      })
    })
    expect(fetchMock).not.toHaveBeenCalled()

    act(() => {
      mocks.screenshotSubscriber?.({
        conversationId: "conversation-1",
        fileName: "capture.png",
        resourceUrl: "magicchat-capture://result/session/token",
        sessionId: "session-1",
      })
    })

    await waitFor(() => expect(mocks.compressImage).toHaveBeenCalledOnce())
    expect(await screen.findByRole("dialog")).toHaveTextContent("capture.png")
    unmount()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })

  it("展示稳定的截图启动错误", async () => {
    mocks.screenshotStart.mockResolvedValue({ code: "permission_denied", status: "error" })
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole("button", { name: "截取屏幕" }))

    expect(mocks.toastError).toHaveBeenCalledWith("请在系统设置中允许 MagicChat 录制屏幕")
  })

  it("切换对话时取消未完成的截图读取并忽略旧结果", async () => {
    let fetchSignal: AbortSignal | undefined
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          fetchSignal = init?.signal ?? undefined
          resolveFetch = resolve
        }),
    )
    const view = renderComposer()

    act(() => {
      mocks.screenshotSubscriber?.({
        conversationId: "conversation-1",
        fileName: "stale.png",
        resourceUrl: "magicchat-capture://result/session/stale",
        sessionId: "session-1",
      })
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    view.rerender(composerElement({ ...conversation, id: "conversation-2" }))
    expect(fetchSignal?.aborted).toBe(true)

    await act(async () => {
      resolveFetch({
        blob: async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
        ok: true,
      } as Response)
      await Promise.resolve()
    })

    expect(mocks.compressImage).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

function renderComposer() {
  return render(composerElement(conversation))
}

function composerElement(currentConversation: ClientConversation) {
  return (
    <ConversationPanelComposer
      conversation={currentConversation}
      draft=""
      draftMentions={[]}
      onCancelReply={vi.fn()}
      onDraftChange={vi.fn()}
      onRichTextModeChange={vi.fn()}
      onSendFile={vi.fn().mockResolvedValue(null)}
      onSendImage={vi.fn().mockResolvedValue(null)}
      onSendMessage={vi.fn()}
      onSendVoice={vi.fn().mockResolvedValue(null)}
      replyTarget={null}
      richTextMode={false}
      sending={false}
    />
  )
}

const conversation: ClientConversation = {
  avatar: "",
  createdAt: "2026-07-31T00:00:00Z",
  id: "conversation-1",
  lastMessageAt: null,
  lastMessageId: null,
  lastMessageSeq: 0,
  lastMessageSummary: "",
  lastChoiceSeq: 0,
  lastMentionedSeq: 0,
  lastReadSeq: 0,
  memberCount: 1,
  members: [],
  name: "截图测试",
  type: "direct",
  unreadCount: 0,
  visibility: "private",
}
