import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SendCardDialog, StandaloneCardDialog } from "@/components/conversation/send-card-dialog"
import type { ClientCardMessageBody } from "@/lib/client-data-api"

const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const mocks = vi.hoisted(() => ({
  listClientContacts: vi.fn(),
  listClientConversations: vi.fn(),
  longConversationName: "这是一个特别特别长并且必须在对话框中截断的会话名称".repeat(4),
  conversations: [
    {
      avatar: "",
      createdAt: "2026-07-14T08:00:00Z",
      id: "conversation-1",
      lastMessageAt: null,
      lastMessageId: null,
      lastMessageSeq: 0,
      lastMessageSummary: "",
      lastChoiceSeq: 0,
      lastMentionedSeq: 0,
      lastReadSeq: 0,
      memberCount: 2,
      name: "设计群",
      type: "group",
      unreadCount: 0,
      visibility: "private",
    },
    {
      avatar: "",
      createdAt: "2026-07-14T08:00:00Z",
      id: "conversation-2",
      lastMessageAt: null,
      lastMessageId: null,
      lastMessageSeq: 0,
      lastMessageSummary: "",
      lastChoiceSeq: 0,
      lastMentionedSeq: 0,
      lastReadSeq: 0,
      memberCount: 2,
      name: "Alice",
      type: "direct",
      unreadCount: 0,
      visibility: "private",
    },
    {
      avatar: "",
      createdAt: "2026-07-14T08:00:00Z",
      id: "conversation-3",
      lastMessageAt: null,
      lastMessageId: null,
      lastMessageSeq: 0,
      lastMessageSummary: "",
      lastChoiceSeq: 0,
      lastMentionedSeq: 0,
      lastReadSeq: 0,
      memberCount: 2,
      name: "这是一个特别特别长并且必须在对话框中截断的会话名称".repeat(4),
      type: "direct",
      unreadCount: 0,
      visibility: "private",
    },
  ],
  resolveClientUsers: vi.fn(),
  sendConversationCard: vi.fn(),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    conversations: mocks.conversations,
    sendConversationCard: mocks.sendConversationCard,
  }),
}))

vi.mock("@/lib/client-api/account", () => ({
  listClientContacts: mocks.listClientContacts,
  resolveClientUsers: mocks.resolveClientUsers,
}))

vi.mock("@/lib/client-api/conversations", () => ({
  listClientConversations: mocks.listClientConversations,
}))

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }))

describe("SendCardDialog", () => {
  afterEach(() => {
    mocks.listClientContacts.mockReset()
    mocks.listClientConversations.mockReset()
    mocks.resolveClientUsers.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
  })

  it("selects one conversation and sends the card", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const card = createCard()
    mocks.sendConversationCard.mockReset()
    mocks.sendConversationCard.mockResolvedValue({
      id: "message-1",
    })

    render(
      <MemoryRouter>
        <SendCardDialog card={card} onOpenChange={onOpenChange} open />
      </MemoryRouter>,
    )

    const sendButton = screen.getByRole("button", { name: "发送" })
    expect(sendButton).toBeDisabled()
    expect(screen.getByText(mocks.longConversationName)).toBeVisible()

    await user.click(screen.getByRole("radio", { name: "设计群" }))
    await user.click(screen.getByRole("radio", { name: "Alice" }))
    expect(screen.getByRole("radio", { name: "设计群" })).not.toBeChecked()
    expect(screen.getByRole("radio", { name: "Alice" })).toBeChecked()
    expect(sendButton).toBeEnabled()
    await user.click(sendButton)

    await waitFor(() => {
      expect(mocks.sendConversationCard).toHaveBeenCalledWith("conversation-2", card)
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("hydrates group avatar members in a document child window", async () => {
    mocks.listClientConversations.mockResolvedValue([mocks.conversations[0]])
    mocks.listClientContacts.mockResolvedValue({
      apps: [],
      directoryMode: "organization",
      groups: [
        {
          avatar: "",
          avatarMembers: [
            {
              avatar: "/avatars/owner.webp",
              id: "user-1",
              name: "Owner",
              nickname: "",
              role: "owner",
              type: "user",
            },
            {
              avatar: "/avatars/member.webp",
              id: "user-2",
              name: "Member",
              nickname: "",
              role: "member",
              type: "user",
            },
          ],
          id: "conversation-1",
          joined: true,
          memberCount: 2,
          name: "设计群",
          type: "group",
          visibility: "private",
        },
      ],
      initialUsers: [],
      userIds: [],
    })
    mocks.resolveClientUsers.mockResolvedValue([])

    render(
      <MemoryRouter>
        <StandaloneCardDialog card={createCard()} onOpenChange={vi.fn()} open />
      </MemoryRouter>,
    )

    const groupTarget = await screen.findByRole("radio", { name: "设计群" })
    expect(groupTarget.closest("label")?.querySelectorAll("img")).toHaveLength(2)
    expect(mocks.resolveClientUsers).not.toHaveBeenCalled()
  })

  it("resolves group avatar members that are unavailable from contacts in a document child window", async () => {
    mocks.listClientConversations.mockResolvedValue([
      {
        ...mocks.conversations[0],
        members: [
          {
            avatar: "",
            email: "",
            id: "user-1",
            name: "",
            nickname: "",
            phone: "",
            role: "owner",
            type: "user",
          },
          {
            avatar: "",
            email: "",
            id: "user-2",
            name: "",
            nickname: "",
            phone: "",
            role: "member",
            type: "user",
          },
        ],
      },
    ])
    mocks.listClientContacts.mockResolvedValue({
      apps: [],
      directoryMode: "organization",
      groups: [],
      initialUsers: [],
      userIds: [],
    })
    mocks.resolveClientUsers.mockResolvedValue([
      {
        avatar: "/avatars/owner.webp",
        email: "owner@example.com",
        id: "user-1",
        lastOnlineAt: null,
        name: "Owner",
        nickname: "",
        online: true,
        phone: "",
        type: "user",
        updatedAt: "2026-08-12T00:00:00Z",
      },
      {
        avatar: "/avatars/member.webp",
        email: "member@example.com",
        id: "user-2",
        lastOnlineAt: null,
        name: "Member",
        nickname: "",
        online: true,
        phone: "",
        type: "user",
        updatedAt: "2026-08-12T00:00:00Z",
      },
    ])

    render(
      <MemoryRouter>
        <StandaloneCardDialog card={createCard()} onOpenChange={vi.fn()} open />
      </MemoryRouter>,
    )

    const groupTarget = await screen.findByRole("radio", { name: "设计群" })
    await waitFor(() => {
      expect(mocks.resolveClientUsers).toHaveBeenCalledWith(
        ["user-1", "user-2"],
        undefined,
        expect.any(AbortSignal),
      )
      expect(groupTarget.closest("label")?.querySelectorAll("img")).toHaveLength(2)
    })
    expect(groupTarget.closest("label")?.textContent).not.toContain("?")
  })

  it("resolves ID-only contact group avatar members in a document child window", async () => {
    mocks.listClientConversations.mockResolvedValue([mocks.conversations[0]])
    mocks.listClientContacts.mockResolvedValue({
      apps: [],
      directoryMode: "organization",
      groups: [
        {
          avatar: "",
          avatarMembers: [
            {
              avatar: "",
              id: "user-1",
              name: "",
              nickname: "",
              role: "owner",
              type: "user",
            },
            {
              avatar: "",
              id: "user-2",
              name: "",
              nickname: "",
              role: "member",
              type: "user",
            },
          ],
          id: "conversation-1",
          joined: true,
          memberCount: 2,
          name: "设计群",
          type: "group",
          visibility: "private",
        },
      ],
      initialUsers: [],
      userIds: [],
    })
    mocks.resolveClientUsers.mockResolvedValue([
      {
        avatar: "/avatars/owner.webp",
        email: "owner@example.com",
        id: "user-1",
        lastOnlineAt: null,
        name: "Owner",
        nickname: "",
        online: true,
        phone: "",
        type: "user",
        updatedAt: "2026-08-12T00:00:00Z",
      },
      {
        avatar: "/avatars/member.webp",
        email: "member@example.com",
        id: "user-2",
        lastOnlineAt: null,
        name: "Member",
        nickname: "",
        online: true,
        phone: "",
        type: "user",
        updatedAt: "2026-08-12T00:00:00Z",
      },
    ])

    render(
      <MemoryRouter>
        <StandaloneCardDialog card={createCard()} onOpenChange={vi.fn()} open />
      </MemoryRouter>,
    )

    const groupTarget = await screen.findByRole("radio", { name: "设计群" })
    await waitFor(() => {
      expect(mocks.resolveClientUsers).toHaveBeenCalledWith(
        ["user-1", "user-2"],
        undefined,
        expect.any(AbortSignal),
      )
      expect(groupTarget.closest("label")?.querySelectorAll("img")).toHaveLength(2)
    })
  })

  it("keeps sending available when group avatar hydration fails", async () => {
    mocks.listClientConversations.mockResolvedValue([mocks.conversations[0]])
    mocks.listClientContacts.mockResolvedValue({
      apps: [],
      directoryMode: "organization",
      groups: [
        {
          avatar: "",
          avatarMembers: [
            {
              avatar: "",
              id: "user-1",
              name: "",
              nickname: "",
              role: "owner",
              type: "user",
            },
          ],
          id: "conversation-1",
          joined: true,
          memberCount: 1,
          name: "设计群",
          type: "group",
          visibility: "private",
        },
      ],
      initialUsers: [],
      userIds: [],
    })
    mocks.resolveClientUsers.mockRejectedValue(new Error("用户资料暂不可用"))

    render(
      <MemoryRouter>
        <StandaloneCardDialog card={createCard()} onOpenChange={vi.fn()} open />
      </MemoryRouter>,
    )

    const groupTarget = await screen.findByRole("radio", { name: "设计群" })
    await waitFor(() => {
      expect(mocks.resolveClientUsers).toHaveBeenCalledWith(
        ["user-1"],
        undefined,
        expect.any(AbortSignal),
      )
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(groupTarget.closest("label")?.querySelector("svg")).toBeInTheDocument()
  })
})

function createCard(): ClientCardMessageBody {
  return {
    description: "任务说明",
    title: "任务标题",
    type: "card",
    url: "/projects/project-1?taskId=task-1",
  }
}
