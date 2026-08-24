import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ClientConversation } from "@/lib/client-data-api"

const mocks = vi.hoisted(() => ({
  listConversationTopics: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return { ...actual, listConversationTopics: mocks.listConversationTopics }
})

import { ConversationTopicsDialog } from "./conversation-topics-dialog"

afterEach(() => vi.clearAllMocks())

describe("ConversationTopicsDialog", () => {
  it("展示话题状态、参与和未读信息，并通过既有回调打开话题", async () => {
    const user = userEvent.setup()
    const onOpenTopic = vi.fn()
    mocks.listConversationTopics.mockResolvedValueOnce({ nextCursor: null, topics: [topic] })

    render(<ConversationTopicsDialog conversation={parentConversation} onOpenTopic={onOpenTopic} />)
    await user.click(screen.getByRole("button", { name: "话题" }))

    const item = await screen.findByRole("button", {
      name: "打开话题：发布讨论，进行中，已参与，未读 3",
    })
    expect(screen.getByText("已参与")).toBeVisible()
    expect(screen.getByText("未读 3")).toBeVisible()

    await user.click(item)
    expect(onOpenTopic).toHaveBeenCalledWith(topic.id)
  })

  it("追加时按话题 ID 去重并保留首屏内容", async () => {
    const user = userEvent.setup()
    mocks.listConversationTopics
      .mockResolvedValueOnce({ nextCursor: "cursor-2", topics: [topic] })
      .mockResolvedValueOnce({ nextCursor: null, topics: [topic, archivedTopic] })

    render(<ConversationTopicsDialog conversation={parentConversation} onOpenTopic={vi.fn()} />)
    await user.click(screen.getByRole("button", { name: "话题" }))
    await screen.findByRole("button", { name: /打开话题：发布讨论/ })
    await user.click(screen.getByRole("button", { name: "加载更多" }))

    expect(await screen.findByRole("button", { name: /打开话题：已归档讨论/ })).toBeVisible()
    expect(screen.getAllByRole("button", { name: /打开话题：发布讨论/ })).toHaveLength(1)
    expect(mocks.listConversationTopics).toHaveBeenLastCalledWith(parentConversation.id, {
      cursor: "cursor-2",
      limit: 50,
    })
  })

  it("关闭后丢弃迟到响应，重新打开可重新加载", async () => {
    const user = userEvent.setup()
    const request = deferred<{ nextCursor: null; topics: ClientConversation[] }>()
    mocks.listConversationTopics
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce({ nextCursor: null, topics: [] })

    render(<ConversationTopicsDialog conversation={parentConversation} onOpenTopic={vi.fn()} />)
    await user.click(screen.getByRole("button", { name: "话题" }))
    await screen.findByText("正在加载话题")
    await user.keyboard("{Escape}")
    await act(async () => request.resolve({ nextCursor: null, topics: [topic] }))

    expect(screen.queryByRole("dialog", { name: "会话话题" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "话题" }))
    expect(await screen.findByText("暂无话题")).toBeVisible()
    await waitFor(() => expect(mocks.listConversationTopics).toHaveBeenCalledTimes(2))
  })
})

const parentConversation: ClientConversation = {
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

const topic: ClientConversation = {
  ...parentConversation,
  id: "topic-1",
  lastMessageAt: "2026-08-02T00:00:00Z",
  lastMessageSummary: "请确认发布时间",
  name: "发布讨论",
  topic: {
    archived: false,
    parentConversationId: parentConversation.id,
    parentConversationName: parentConversation.name,
    parentConversationType: "group",
    participating: true,
    sourceMessageId: "message-1",
    sourceMessageSeq: 1,
    sourceSender: { avatar: "", id: "user-1", name: "Alice", type: "user" },
  },
  type: "topic",
  unreadCount: 3,
}

const archivedTopic: ClientConversation = {
  ...topic,
  id: "topic-2",
  name: "已归档讨论",
  topic: {
    archived: true,
    parentConversationId: parentConversation.id,
    parentConversationName: parentConversation.name,
    parentConversationType: "group",
    participating: false,
    sourceMessageId: "message-1",
    sourceMessageSeq: 1,
    sourceSender: { avatar: "", id: "user-1", name: "Alice", type: "user" },
  },
  unreadCount: 0,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
