import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationPanel, type ConversationPanelMessage } from "@/components/conversation-panel"
import type { ClientConversation } from "@/lib/client-data-api"
import { ClientDataContext, type ClientDataContextValue } from "@/lib/client-data-context"

const mocks = vi.hoisted(() => ({
  readTemporaryFileURLs: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()

  return {
    ...actual,
    readTemporaryFileURLs: mocks.readTemporaryFileURLs,
  }
})

describe("图片消息操作", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readTemporaryFileURLs.mockResolvedValue([
      {
        expiresAt: "2026-07-17T12:00:00Z",
        fileId: "file-1",
        url: "https://example.com/image.png",
      },
    ])
  })

  it("右键菜单不展示复制操作", async () => {
    renderImageConversation()

    await openImageMessageActionMenu()

    expect(await screen.findByRole("menuitem", { name: "回复" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "复制" })).not.toBeInTheDocument()
  })
})

function renderImageConversation() {
  return render(
    <MemoryRouter>
      <ClientDataContext.Provider value={createClientDataValue()}>
        <ConversationPanel
          conversation={createConversation()}
          currentUserId="user-1"
          draft=""
          historyError={null}
          historyLoading={false}
          historyLoadingBefore={false}
          messages={[createImageMessage()]}
          onCancelReply={vi.fn()}
          onDraftChange={vi.fn()}
          onLoadBeforeMessages={vi.fn()}
          onReplyToMessage={vi.fn()}
          onRevokeMessage={vi.fn()}
          onRichTextModeChange={vi.fn()}
          onSendFile={async () => null}
          onSendImage={async () => null}
          onSendMessage={vi.fn()}
          onSendVoice={async () => null}
          replyTarget={null}
          richTextMode={false}
          sending={false}
        />
      </ClientDataContext.Provider>
    </MemoryRouter>,
  )
}

async function openImageMessageActionMenu() {
  const image = await screen.findByRole("button", { name: "预览图片" })
  const messageActionTrigger = image.closest("[data-message-action-trigger]")
  if (!messageActionTrigger) throw new Error("missing message action trigger")

  fireEvent.contextMenu(messageActionTrigger)
}

function createImageMessage(): ConversationPanelMessage {
  return {
    author: "Alice",
    avatar: "",
    body: {
      fileId: "file-1",
      height: 120,
      type: "image",
      width: 160,
    },
    canRevoke: false,
    createdAt: "2026-07-17T10:00:00Z",
    delegatedByName: "",
    id: "message-image-1",
    mentionTarget: null,
    reactionVersion: 0,
    reactions: [],
    role: "other",
    senderAppId: null,
    senderAppProfile: null,
    senderUserId: "user-2",
    time: "10:00",
  }
}

function createConversation(): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-17T10:00:00Z",
    id: "conversation-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 1,
    lastMessageSummary: "[图片]",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 1,
    memberCount: 2,
    name: "测试会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
  }
}

function createClientDataValue(): ClientDataContextValue {
  return {
    contacts: [],
    me: {
      avatar: "",
      createdAt: "2026-07-17T10:00:00Z",
      email: "me@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "我",
      nickname: "",
      phone: "",
      status: "active",
    },
    openDirectConversation: vi.fn(),
  } as unknown as ClientDataContextValue
}
