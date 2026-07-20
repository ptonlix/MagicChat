import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ConversationSidebar } from "@/components/conversation/conversation-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import type { ClientConversation, ClientUser } from "@/lib/client-data-api"

describe("ConversationSidebar", () => {
  it("uses the application fallback avatar for app conversations", () => {
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId="conversation-app-1"
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[createAppConversation()]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    const conversationItem = screen.getByText("智能助手").closest("button")
    expect(conversationItem).not.toBeNull()
    expect(conversationItem?.querySelector(".lucide-bot")).toBeInTheDocument()
  })

  it("shows a topic name together with its parent conversation name", () => {
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId="topic-1"
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[createTopicConversation()]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    const item = screen.getByText("发布计划 - 产品群").closest("button")
    expect(item?.querySelector(".lucide-users-round")).toBeInTheDocument()
    expect(item?.querySelector('[aria-label="Alice"]')).toBeInTheDocument()
  })

  it("pins an ordinary conversation from its context menu", async () => {
    const onSetConversationPinned = vi.fn().mockResolvedValue(undefined)
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId="conversation-app-1"
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[createAppConversation()]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={onSetConversationPinned}
        />
      </SidebarProvider>
    )

    fireEvent.contextMenu(screen.getByText("智能助手").closest("button")!)
    fireEvent.click(await screen.findByText("置顶对话"))

    await waitFor(() =>
      expect(onSetConversationPinned).toHaveBeenCalledWith(
        "conversation-app-1",
        true
      )
    )
  })

  it("does not show a pin action for the built-in assistant", async () => {
    const assistant = createAppConversation()
    assistant.pinned = true
    assistant.members = [
      {
        avatar: "",
        email: "",
        id: "00000000-0000-0000-0000-000000000001",
        name: "茉莉",
        nickname: "",
        phone: "",
        role: "member",
        type: "app",
      },
    ]
    assistant.name = "茉莉"
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId={assistant.id}
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[assistant]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    fireEvent.contextMenu(screen.getByText("茉莉").closest("button")!)
    expect(await screen.findByText("消息免打扰")).toBeInTheDocument()
    expect(screen.queryByText("置顶对话")).not.toBeInTheDocument()
    expect(screen.queryByText("取消置顶")).not.toBeInTheDocument()
  })

  it("uses a neutral background without a pin icon for pinned conversations", () => {
    const conversation = createAppConversation()
    conversation.pinned = true
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[conversation]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    const item = screen.getByText("智能助手").closest("button")
    expect(item).toHaveClass("bg-neutral-100")
    expect(item?.querySelector(".lucide-pin")).not.toBeInTheDocument()
  })
})

function createAppConversation(): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-17T00:00:00Z",
    id: "conversation-app-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "暂无消息",
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    members: [],
    name: "智能助手",
    type: "app",
    unreadCount: 0,
    visibility: "private",
  }
}

function createTopicConversation(): ClientConversation {
  return {
    ...createAppConversation(),
    id: "topic-1",
    name: "发布计划",
    topic: {
      archived: false,
      parentConversationId: "parent-1",
      parentConversationName: "产品群",
      parentConversationType: "group",
      participating: true,
      sourceMessageId: "message-1",
      sourceMessageSeq: 1,
      sourceSender: {
        avatar: "/avatars/alice.webp",
        id: "user-2",
        name: "Alice",
        type: "user",
      },
    },
    type: "topic",
  }
}

function createCurrentUser(): ClientUser {
  return {
    avatar: "",
    createdAt: "2026-07-17T00:00:00Z",
    email: "me@example.com",
    id: "user-1",
    lastOnlineAt: null,
    name: "当前用户",
    nickname: "",
    phone: "",
    status: "active",
  }
}
