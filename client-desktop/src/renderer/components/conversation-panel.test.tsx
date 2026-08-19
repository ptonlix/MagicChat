import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { ConversationPanel, type ConversationPanelMessage } from "@/components/conversation-panel"
import type { ClientConversation } from "@/lib/client-data-api"
import { ClientDataContext, type ClientDataContextValue } from "@/lib/client-data-context"

describe("ConversationPanel", () => {
  it("treats a history header as the first message instead of showing an empty state", () => {
    render(
      <ClientDataContext.Provider value={createClientDataValue()}>
        <ConversationPanel
          conversation={createConversation("topic-1")}
          currentUserId="user-1"
          draft=""
          historyError={null}
          historyHeader={<div>话题来源消息</div>}
          historyLoading={false}
          historyLoadingBefore={false}
          messages={[]}
          onCancelReply={vi.fn()}
          onDraftChange={vi.fn()}
          onLoadBeforeMessages={vi.fn()}
          onReplyToMessage={vi.fn()}
          onRevokeMessage={vi.fn()}
          onRichTextModeChange={vi.fn()}
          onSendFile={async () => null}
          onSendImage={async () => null}
          onSendVoice={async () => null}
          onSendMessage={vi.fn()}
          replyTarget={null}
          richTextMode={false}
          sending={false}
        />
      </ClientDataContext.Provider>,
    )

    expect(screen.getByText("话题来源消息")).toBeInTheDocument()
    expect(screen.queryByTestId("conversation-history-empty")).toBeNull()
    expect(screen.queryByText("暂无消息")).toBeNull()
  })

  it("shows a closed-topic system message without a locked composer footer", () => {
    render(
      <MemoryRouter>
        <ClientDataContext.Provider value={createClientDataValue()}>
          <ConversationPanel
            conversation={createConversation("topic-1")}
            currentUserId="user-1"
            draft=""
            historyError={null}
            historyLoading={false}
            historyLoadingBefore={false}
            messages={[
              {
                author: "系统",
                avatar: "",
                body: {
                  actor: { displayName: "Alice", id: "user-1" },
                  event: "topic_closed",
                  type: "system_event",
                },
                canRevoke: false,
                createdAt: "2026-07-20T12:00:00Z",
                delegatedByName: "",
                id: "message-1",
                mentionTarget: null,
                reactionVersion: 0,
                reactions: [],
                role: "system",
                senderAppId: null,
                senderAppProfile: null,
                senderUserId: null,
                time: "12:00",
              },
            ]}
            onCancelReply={vi.fn()}
            onDraftChange={vi.fn()}
            onLoadBeforeMessages={vi.fn()}
            onReplyToMessage={vi.fn()}
            onRevokeMessage={vi.fn()}
            onRichTextModeChange={vi.fn()}
            onSendFile={async () => null}
            onSendImage={async () => null}
            onSendVoice={async () => null}
            onSendMessage={vi.fn()}
            readOnly
            replyTarget={null}
            richTextMode={false}
            sending={false}
          />
        </ClientDataContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByText("Alice 已将话题关闭")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("输入消息")).not.toBeInTheDocument()
    expect(screen.queryByText("话题已归档，无法继续发言")).not.toBeInTheDocument()
  })

  it("keeps retained history visible but disables message mutations when access is revoked", async () => {
    const onRevokeMessage = vi.fn()
    const onSetMessageReaction = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ClientDataContext.Provider value={createClientDataValue()}>
          <ConversationPanel
            conversation={{
              ...createConversation("conversation-1"),
              canSend: false,
            }}
            currentUserId="user-1"
            draft=""
            historyError={null}
            historyLoading={false}
            historyLoadingBefore={false}
            messages={[
              {
                author: "我",
                avatar: "",
                body: { content: "保留的历史消息", type: "text" },
                canRevoke: true,
                createdAt: "2026-07-20T12:00:00Z",
                delegatedByName: "",
                id: "message-1",
                mentionTarget: null,
                reactionVersion: 1,
                reactions: [
                  {
                    count: 1,
                    reactedByMe: true,
                    text: "👍",
                    users: [],
                  },
                ],
                role: "me",
                senderAppId: null,
                senderAppProfile: null,
                senderUserId: "user-1",
                time: "12:00",
              },
            ]}
            onCancelReply={vi.fn()}
            onDraftChange={vi.fn()}
            onLoadBeforeMessages={vi.fn()}
            onReplyToMessage={vi.fn()}
            onRevokeMessage={onRevokeMessage}
            onRichTextModeChange={vi.fn()}
            onSendFile={async () => null}
            onSendImage={async () => null}
            onSendVoice={async () => null}
            onSendMessage={vi.fn()}
            onSetMessageReaction={onSetMessageReaction}
            readOnly
            readOnlyReason="你当前无权直接使用此应用"
            replyTarget={null}
            richTextMode={false}
            sending={false}
          />
        </ClientDataContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByText("保留的历史消息")).toBeVisible()
    expect(screen.queryByPlaceholderText("输入消息")).not.toBeInTheDocument()
    const reaction = screen.getByRole("button", { name: "移除表情 👍" })
    expect(reaction).toBeDisabled()
    fireEvent.click(reaction)
    expect(onSetMessageReaction).not.toHaveBeenCalled()

    const messageActionTrigger = screen
      .getByText("保留的历史消息")
      .closest("[data-message-action-trigger]")
    expect(messageActionTrigger).not.toBeNull()
    fireEvent.contextMenu(messageActionTrigger!)
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "撤回" })).not.toBeInTheDocument(),
    )
    expect(onRevokeMessage).not.toHaveBeenCalled()
  })

  it("refocuses the composer textarea when a reply target is selected", async () => {
    const { rerender } = render(
      <ConversationPanel
        conversation={createConversation("conversation-1")}
        currentUserId="user-1"
        draft=""
        historyError={null}
        historyLoading={false}
        historyLoadingBefore={false}
        messages={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onLoadBeforeMessages={vi.fn()}
        onReplyToMessage={vi.fn()}
        onRevokeMessage={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendVoice={async () => null}
        onSendMessage={vi.fn()}
        replyTarget={null}
        richTextMode={false}
        sending={false}
      />,
    )

    const composer = screen.getByPlaceholderText("输入消息")
    const sendButton = screen.getByRole("button", { name: "发送消息" })

    await waitFor(() => expect(composer).toHaveFocus())
    sendButton.focus()
    expect(sendButton).toHaveFocus()

    rerender(
      <ConversationPanel
        conversation={createConversation("conversation-1")}
        currentUserId="user-1"
        draft=""
        historyError={null}
        historyLoading={false}
        historyLoadingBefore={false}
        messages={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onLoadBeforeMessages={vi.fn()}
        onReplyToMessage={vi.fn()}
        onRevokeMessage={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendVoice={async () => null}
        onSendMessage={vi.fn()}
        replyTarget={{
          author: "李四",
          id: "message-1",
          summary: "收到",
        }}
        richTextMode={false}
        sending={false}
      />,
    )

    await waitFor(() => expect(composer).toHaveFocus())
  })

  it("does not send when Enter belongs to an IME interaction", () => {
    const onSendMessage = vi.fn()

    render(
      <ClientDataContext.Provider value={createClientDataValue()}>
        <ConversationPanel
          conversation={createConversation("conversation-1")}
          currentUserId="user-1"
          draft="nihao"
          historyError={null}
          historyLoading={false}
          historyLoadingBefore={false}
          messages={[]}
          onCancelReply={vi.fn()}
          onDraftChange={vi.fn()}
          onLoadBeforeMessages={vi.fn()}
          onReplyToMessage={vi.fn()}
          onRevokeMessage={vi.fn()}
          onRichTextModeChange={vi.fn()}
          onSendFile={async () => null}
          onSendImage={async () => null}
          onSendVoice={async () => null}
          onSendMessage={onSendMessage}
          replyTarget={null}
          richTextMode={false}
          sending={false}
        />
      </ClientDataContext.Provider>,
    )

    const composer = screen.getByPlaceholderText("输入消息")
    const compositionKeyDownNotCanceled = fireEvent.keyDown(composer, {
      code: "Enter",
      isComposing: true,
      key: "Enter",
    })
    const processKeyDownNotCanceled = fireEvent.keyDown(composer, {
      code: "Enter",
      key: "Enter",
      keyCode: 229,
    })

    expect(compositionKeyDownNotCanceled).toBe(true)
    expect(processKeyDownNotCanceled).toBe(true)
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it("在标题和历史区展示实时状态并转发输入框焦点事件", async () => {
    const onDraftBlur = vi.fn()
    const onDraftFocus = vi.fn()
    render(
      <MemoryRouter>
        <ClientDataContext.Provider value={createClientDataValue()}>
          <ConversationPanel
            conversation={createConversation("conversation-1")}
            currentUserId="user-1"
            draft=""
            historyError={null}
            historyLoading={false}
            historyLoadingBefore={false}
            messages={[createAppPanelMessage({ appId: "app-1", author: "助手", avatar: "" })]}
            onCancelReply={vi.fn()}
            onDraftBlur={onDraftBlur}
            onDraftChange={vi.fn()}
            onDraftFocus={onDraftFocus}
            onLoadBeforeMessages={vi.fn()}
            onReplyToMessage={vi.fn()}
            onRevokeMessage={vi.fn()}
            onRichTextModeChange={vi.fn()}
            onSendFile={async () => null}
            onSendImage={async () => null}
            onSendVoice={async () => null}
            onSendMessage={vi.fn()}
            replyTarget={null}
            richTextMode={false}
            sending={false}
            status="正在思考"
          />
        </ClientDataContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getAllByText("正在思考")).toHaveLength(2)
    expect(screen.getByTestId("conversation-status-bubble")).toBeVisible()
    const composer = screen.getByPlaceholderText("输入消息")
    await waitFor(() => expect(onDraftFocus).toHaveBeenCalled())
    fireEvent.blur(composer)
    expect(onDraftBlur).toHaveBeenCalledOnce()
  })

  it("opens the app profile popover from an app message avatar", async () => {
    const user = userEvent.setup()
    const openAppConversation = vi.fn()

    render(
      <MemoryRouter>
        <ClientDataContext.Provider
          value={createClientDataValue({
            contactApps: [
              {
                avatar: "/assets/apps/assistant.webp",
                creatorUserId: null,
                description: "企业助手",
                id: "app-1",
                name: "智能助手",
                online: true,
                type: "app",
              },
            ],
            openAppConversation,
          })}
        >
          <ConversationPanel
            conversation={createConversation("conversation-1")}
            currentUserId="user-1"
            draft=""
            historyError={null}
            historyLoading={false}
            historyLoadingBefore={false}
            messages={[
              createAppPanelMessage({
                appId: "app-1",
                avatar: "",
                author: "智能助手",
              }),
            ]}
            onCancelReply={vi.fn()}
            onDraftChange={vi.fn()}
            onLoadBeforeMessages={vi.fn()}
            onReplyToMessage={vi.fn()}
            onRevokeMessage={vi.fn()}
            onRichTextModeChange={vi.fn()}
            onSendFile={async () => null}
            onSendImage={async () => null}
            onSendVoice={async () => null}
            onSendMessage={vi.fn()}
            replyTarget={null}
            richTextMode={false}
            sending={false}
          />
        </ClientDataContext.Provider>
      </MemoryRouter>,
    )

    const appProfileTrigger = screen.getByRole("button", {
      name: "智能助手资料",
    })

    await user.click(appProfileTrigger)

    expect(await screen.findByText("企业助手")).toBeInTheDocument()
    expect(screen.getByText("类型")).toBeInTheDocument()
    expect(screen.getByText("应用")).toBeInTheDocument()
    expect(screen.getByText("状态")).toBeInTheDocument()
    expect(screen.getByText("在线")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发消息" })).toBeInTheDocument()
  })

  it("restores an owned revoked Markdown message for re-editing", async () => {
    const user = userEvent.setup()
    const onCancelReply = vi.fn()
    const onDraftChange = vi.fn()
    const onRichTextModeChange = vi.fn()
    const message: ConversationPanelMessage = {
      ...createAppPanelMessage({ appId: "", author: "我", avatar: "" }),
      body: { editableBody: { content: "**再次编辑**", type: "markdown" }, type: "revoked" },
      role: "me",
      senderAppId: null,
      senderUserId: "user-1",
    }

    render(
      <MemoryRouter>
        <ClientDataContext.Provider value={createClientDataValue()}>
          <ConversationPanel
            conversation={createConversation("conversation-1")}
            currentUserId="user-1"
            draft="旧草稿"
            historyError={null}
            historyLoading={false}
            historyLoadingBefore={false}
            messages={[message]}
            onCancelReply={onCancelReply}
            onDraftChange={onDraftChange}
            onLoadBeforeMessages={vi.fn()}
            onReplyToMessage={vi.fn()}
            onRevokeMessage={vi.fn()}
            onRichTextModeChange={onRichTextModeChange}
            onSendFile={async () => null}
            onSendImage={async () => null}
            onSendVoice={async () => null}
            onSendMessage={vi.fn()}
            replyTarget={null}
            richTextMode={false}
            sending={false}
          />
        </ClientDataContext.Provider>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole("button", { name: "重新编辑" }))
    expect(onCancelReply).toHaveBeenCalledOnce()
    expect(onDraftChange).toHaveBeenCalledWith("**再次编辑**", [])
    expect(onRichTextModeChange).toHaveBeenCalledWith(true)
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveFocus())
  })
})

function createConversation(id: string): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-09T00:00:00Z",
    id,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    members: [],
    name: "测试会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
  }
}

function createAppPanelMessage({
  appId,
  author,
  avatar,
}: {
  appId: string
  author: string
  avatar: string
}): ConversationPanelMessage {
  return {
    author,
    avatar,
    body: {
      content: "应用消息",
      type: "text",
    },
    canRevoke: false,
    createdAt: "2026-07-20T10:00:00Z",
    delegatedByName: "",
    id: "message-1",
    mentionTarget: null,
    reactionVersion: 0,
    reactions: [],
    role: "other",
    senderAppId: appId,
    senderAppProfile: {
      avatar,
      description: "",
      id: appId,
      name: author,
      online: false,
    },
    senderUserId: null,
    time: "10:00",
  }
}

function createClientDataValue(
  overrides: Partial<ClientDataContextValue> = {},
): ClientDataContextValue {
  const value: Partial<ClientDataContextValue> = {
    contactApps: [],
    contactGroups: [],
    contacts: [],
    contactsError: null,
    contactsLoading: false,
    contactsRefreshing: false,
    conversations: [],
    me: {
      avatar: "",
      createdAt: "2026-07-09T00:00:00Z",
      email: "me@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "张三",
      nickname: "",
      phone: "",
      status: "active",
    },
    meError: null,
    meLoading: false,
    meRefreshing: false,
    openAppConversation: vi.fn(),
    openDirectConversation: vi.fn(),
    ...overrides,
  }

  return value as ClientDataContextValue
}
