import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ClientConversation } from "@/lib/client-data-api"

const mocks = vi.hoisted(() => ({
  listConversationAttachments: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return { ...actual, listConversationAttachments: mocks.listConversationAttachments }
})
vi.mock("@/components/message-attachment", () => ({
  MessageAttachment: ({ file }: { file: { fileName: string } }) => <span>{file.fileName}</span>,
}))

import { ConversationAttachmentsDialog } from "./conversation-attachments-dialog"

afterEach(() => {
  mocks.listConversationAttachments.mockReset()
  vi.clearAllMocks()
})

describe("ConversationAttachmentsDialog", () => {
  it("首屏失败后可重试并展示受保护附件组件", async () => {
    const user = userEvent.setup()
    mocks.listConversationAttachments
      .mockRejectedValueOnce(new Error("服务暂不可用"))
      .mockResolvedValueOnce({ nextCursor: null, attachments: [attachment] })

    render(<ConversationAttachmentsDialog conversation={conversation} />)
    await user.click(screen.getByRole("button", { name: "历史附件" }))
    expect(await screen.findByText("加载历史附件失败")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "重试" }))

    expect(await screen.findByText("设计稿.pdf")).toBeVisible()
    expect(mocks.listConversationAttachments).toHaveBeenLastCalledWith(conversation.id, {
      cursor: undefined,
      limit: 50,
    })
  })

  it("追加失败不清空已有附件，关闭后丢弃迟到响应", async () => {
    const user = userEvent.setup()
    const request = deferred<{ nextCursor: null; attachments: (typeof attachment)[] }>()
    mocks.listConversationAttachments
      .mockResolvedValueOnce({ nextCursor: "cursor-2", attachments: [attachment] })
      .mockRejectedValueOnce(new Error("下一页失败"))
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce({ nextCursor: null, attachments: [] })

    render(<ConversationAttachmentsDialog conversation={conversation} />)
    await user.click(screen.getByRole("button", { name: "历史附件" }))
    await screen.findByText("设计稿.pdf")
    await user.click(await screen.findByRole("button", { name: "加载更多" }))
    expect(await screen.findByText("加载历史附件失败")).toBeVisible()
    expect(screen.getByText("设计稿.pdf")).toBeVisible()

    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "历史附件" }))
    await screen.findByText("正在加载历史附件")
    await user.keyboard("{Escape}")
    await act(async () => request.resolve({ nextCursor: null, attachments: [attachment] }))

    expect(screen.queryByRole("dialog", { name: "历史附件" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "历史附件" }))
    expect(await screen.findByText("暂无历史附件")).toBeVisible()
    await waitFor(() => expect(mocks.listConversationAttachments).toHaveBeenCalledTimes(4))
  })
})

const conversation: ClientConversation = {
  avatar: "",
  createdAt: "2026-08-01T00:00:00Z",
  id: "conversation-1",
  lastChoiceSeq: 0,
  lastMentionedSeq: 0,
  lastMessageAt: null,
  lastMessageId: null,
  lastMessageSeq: 0,
  lastMessageSummary: "",
  lastReadSeq: 0,
  memberCount: 2,
  name: "项目群",
  type: "group",
  unreadCount: 0,
  visibility: "private",
}

const attachment = {
  createdAt: "2026-08-02T00:00:00Z",
  file: {
    fileId: "file-1",
    fileName: "设计稿.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    type: "file" as const,
  },
  messageId: "message-1",
  seq: 1,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
