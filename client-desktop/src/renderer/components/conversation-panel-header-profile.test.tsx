import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationPanel } from "@/components/conversation-panel"
import type { ClientConversation, ClientConversationMember } from "@/lib/client-data-api"
import { ClientDataContext, type ClientDataContextValue } from "@/lib/client-data-context"

const localeMocks = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("@/components/locale-provider", async () => {
  const { createElement, Fragment } = await import("react")
  const { translate } = await import("@/lib/i18n")
  return {
    LocaleProvider: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    useLocale: () => ({
      fontScale: "normal" as const,
      locale: localeMocks.locale,
      t: (key: never, params?: Readonly<Record<string, string | number>>) =>
        translate(localeMocks.locale, key, params),
    }),
  }
})
vi.mock("sonner", () => ({
  toast: { error: localeMocks.toastError, success: localeMocks.toastSuccess },
}))

describe("ConversationPanel header profile", () => {
  beforeEach(() => {
    localeMocks.locale = "zh-CN"
    vi.clearAllMocks()
  })
  it("opens the direct conversation user profile and previews its avatar", async () => {
    const user = userEvent.setup()
    const otherMember = createMember({
      avatar: "/assets/users/li-si.webp",
      email: "lisi@example.com",
      id: "user-2",
      name: "李四",
      phone: "13800138000",
    })
    const conversation = createConversation({
      avatar: otherMember.avatar,
      members: [createMember(), otherMember],
      name: otherMember.name,
      type: "direct",
    })

    renderConversationHeader(conversation, {
      contacts: [
        {
          ...otherMember,
          lastOnlineAt: null,
          online: true,
          type: "user",
        },
      ],
    })

    await user.click(screen.getByRole("button", { name: "李四资料" }))

    expect(await screen.findByText("用户资料")).toBeInTheDocument()
    expect(screen.getByText("lisi@example.com")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发消息" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "预览李四头像" }))

    expect(await screen.findByRole("dialog", { name: "李四头像预览" })).toBeInTheDocument()
  })

  it("opens the application profile from an app conversation header", async () => {
    const user = userEvent.setup()
    const developer = createMember({
      email: "developer@example.com",
      id: "user-2",
      name: "应用开发者",
    })
    const appMember = createMember({
      avatar: "/assets/apps/assistant.webp",
      email: "",
      id: "app-1",
      name: "智能助手",
      type: "app",
    })
    const conversation = createConversation({
      avatar: appMember.avatar,
      id: "conversation-app-1",
      members: [createMember(), appMember],
      name: appMember.name,
      type: "app",
    })

    renderConversationHeader(conversation, {
      contactApps: [
        {
          avatar: appMember.avatar,
          creatorUserId: developer.id,
          description: "企业智能助手",
          id: appMember.id,
          name: appMember.name,
          online: true,
          type: "app",
        },
      ],
      contacts: [
        {
          ...developer,
          lastOnlineAt: null,
          online: true,
          type: "user",
        },
      ],
    })

    const appProfileTrigger = screen.getByRole("button", {
      name: "智能助手资料",
    })

    await user.click(appProfileTrigger)

    expect(await screen.findByText("企业智能助手")).toBeInTheDocument()
    const profile = screen.getByRole("dialog")
    expect(within(profile).getByText("类型")).toBeInTheDocument()
    expect(within(profile).getByText("应用")).toBeInTheDocument()
    expect(within(profile).getByText("开发者")).toBeInTheDocument()
    const developerLink = within(profile).getByRole("button", {
      name: "应用开发者资料",
    })

    await user.click(developerLink)
    expect(await screen.findByText("用户资料")).toBeInTheDocument()
    expect(screen.getByText("developer@example.com")).toBeInTheDocument()
  })

  it("opens the group profile and previews its composite avatar", async () => {
    const user = userEvent.setup()
    const conversation = createConversation({
      memberCount: 3,
      members: [
        createMember(),
        createMember({ id: "user-2", name: "李四" }),
        createMember({ id: "user-3", name: "王五" }),
      ],
      name: "项目群",
      type: "group",
    })

    renderConversationHeader(conversation)

    await user.click(screen.getByRole("button", { name: "项目群资料" }))

    expect(await screen.findByText("3 人群聊")).toBeInTheDocument()
    expect(screen.getByText("群聊资料")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "预览项目群头像" }))

    expect(await screen.findByRole("dialog", { name: "项目群头像预览" })).toBeInTheDocument()
  })

  it("非好友资料提供加好友操作", async () => {
    const user = userEvent.setup()
    const createFriendRequest = vi.fn().mockResolvedValue(undefined)
    const otherMember = createMember({
      email: "wangwu@example.com",
      id: "user-2",
      name: "王五",
    })
    const conversation = createConversation({
      members: [createMember(), otherMember],
      name: otherMember.name,
      type: "direct",
    })

    renderConversationHeader(conversation, {
      contactDirectoryMode: "friends",
      createFriendRequest,
    })

    await user.click(screen.getByRole("button", { name: "王五资料" }))
    await user.click(await screen.findByRole("button", { name: "加好友" }))

    expect(createFriendRequest).toHaveBeenCalledWith("user-2")
    expect(screen.queryByRole("button", { name: "发消息" })).not.toBeInTheDocument()
  })

  it("收到好友申请时可以从资料弹窗接受", async () => {
    const user = userEvent.setup()
    const acceptFriendRequest = vi.fn().mockResolvedValue(undefined)
    const otherMember = createMember({ id: "user-2", name: "王五" })
    renderConversationHeader(
      createConversation({
        members: [createMember(), otherMember],
        name: otherMember.name,
        type: "direct",
      }),
      {
        acceptFriendRequest,
        contactDirectoryMode: "friends",
        incomingFriendRequests: [friendRequestFixture("incoming", "user-2", "user-1")],
      },
    )

    await user.click(screen.getByRole("button", { name: "王五资料" }))
    await user.click(await screen.findByRole("button", { name: "接受好友申请" }))

    expect(acceptFriendRequest).toHaveBeenCalledWith("incoming")
  })

  it("已发送好友申请时展示禁用等待态", async () => {
    const user = userEvent.setup()
    const createFriendRequest = vi.fn().mockResolvedValue(undefined)
    const otherMember = createMember({ id: "user-2", name: "王五" })
    renderConversationHeader(
      createConversation({
        members: [createMember(), otherMember],
        name: otherMember.name,
        type: "direct",
      }),
      {
        contactDirectoryMode: "friends",
        createFriendRequest,
        outgoingFriendRequests: [friendRequestFixture("outgoing", "user-1", "user-2")],
      },
    )

    await user.click(screen.getByRole("button", { name: "王五资料" }))

    expect(await screen.findByRole("button", { name: "已发送好友申请" })).toBeDisabled()
    expect(createFriendRequest).not.toHaveBeenCalled()
  })

  it("英文环境使用本地化的好友操作和成功反馈", async () => {
    localeMocks.locale = "en"
    const user = userEvent.setup()
    const createFriendRequest = vi.fn().mockResolvedValue(undefined)
    const otherMember = createMember({ id: "user-2", name: "王五" })
    renderConversationHeader(
      createConversation({
        members: [createMember(), otherMember],
        name: otherMember.name,
        type: "direct",
      }),
      { contactDirectoryMode: "friends", createFriendRequest },
    )

    await user.click(screen.getByRole("button", { name: "王五 profile" }))
    await user.click(await screen.findByRole("button", { name: "Add friend" }))

    expect(createFriendRequest).toHaveBeenCalledWith("user-2")
    expect(localeMocks.toastSuccess).toHaveBeenCalledWith("Friend request sent")
  })

  it("在窄窗口中保留超长 ASCII 和 Unicode 资料值并允许换行滚动", async () => {
    const longName = `用户${"超长名称".repeat(30)}`
    const longEmail = `${"a".repeat(180)}@example.com`
    const otherMember = createMember({
      email: longEmail,
      id: "user-2",
      name: longName,
      phone: "138001380001380013800013800138000138000",
    })
    renderConversationHeader(
      createConversation({
        members: [createMember(), otherMember],
        name: longName,
        type: "direct",
      }),
      {
        contacts: [{ ...otherMember, lastOnlineAt: null, online: true, type: "user" }],
      },
    )

    await userEvent.click(screen.getByRole("button", { name: `${longName}资料` }))
    const profile = await screen.findByRole("dialog")
    expect(profile).toHaveClass(
      "max-h-[calc(100vh-2rem)]",
      "w-[min(18rem,calc(100vw-2rem))]",
      "overflow-x-hidden",
      "overflow-y-auto",
    )
    expect(within(profile).getByText(longEmail)).toHaveClass("overflow-wrap-anywhere", "min-w-0")
  })
})

function renderConversationHeader(
  conversation: ClientConversation,
  clientDataOverrides: Partial<ClientDataContextValue> = {},
) {
  render(
    <MemoryRouter>
      <ClientDataContext.Provider value={createClientDataValue(clientDataOverrides)}>
        <ConversationPanel
          conversation={conversation}
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
        />
      </ClientDataContext.Provider>
    </MemoryRouter>,
  )
}

function createConversation(overrides: Partial<ClientConversation> = {}): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-10T00:00:00Z",
    id: "conversation-1",
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
    ...overrides,
  }
}

function createMember(overrides: Partial<ClientConversationMember> = {}): ClientConversationMember {
  return {
    avatar: "",
    email: "me@example.com",
    id: "user-1",
    name: "张三",
    nickname: "",
    phone: "",
    role: "member",
    type: "user",
    ...overrides,
  }
}

function friendRequestFixture(id: string, requesterUserId: string, addresseeUserId: string) {
  return {
    addresseeUserId,
    createdAt: "2026-08-19T00:00:00Z",
    handledAt: null,
    id,
    requesterUserId,
    status: "pending" as const,
    updatedAt: "2026-08-19T00:00:00Z",
  }
}

function createClientDataValue(
  overrides: Partial<ClientDataContextValue> = {},
): ClientDataContextValue {
  return {
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
  } as ClientDataContextValue
}
