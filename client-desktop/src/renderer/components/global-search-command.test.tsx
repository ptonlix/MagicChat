import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { GlobalSearchCommand } from "@/components/global-search-command"
import type {
  ClientConversation,
  ClientConversationMember,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import type { DirectorySearchItem } from "@/lib/local-search"

describe("GlobalSearchCommand", () => {
  it("switches between combined, directory, and conversation scopes", async () => {
    const user = userEvent.setup()
    renderSearch([createConversation({ name: "产品对话" })], vi.fn(), {
      contacts: [createContact({ name: "产品联系人" })],
    })

    await openSearch(user)
    expect(screen.getByText("输入关键词开始搜索")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "聊天记录" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "文档" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "任务" })).toBeInTheDocument()

    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "产品")
    expect(screen.getByText("产品联系人")).toBeInTheDocument()
    expect(screen.getByText("产品对话")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "通讯录" }))
    expect(screen.getByText("产品联系人")).toBeInTheDocument()
    expect(screen.queryByText("产品对话")).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "对话" }))
    expect(screen.queryByText("产品联系人")).not.toBeInTheDocument()
    expect(screen.getByText("产品对话")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "聊天记录" }))
    expect(screen.getByText("待完善")).toBeInTheDocument()
  })

  it("shows directory avatars and opens a pinyin-matched contact", async () => {
    const user = userEvent.setup()
    const onSelectDirectoryItem = vi.fn()
    const contact = createContact({
      avatar: "/avatars/ming.webp",
      name: "李小明",
      nickname: "小明",
    })
    renderSearch([], vi.fn(), { contacts: [contact], onSelectDirectoryItem })

    await openSearch(user)
    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "lxm")
    const option = screen.getByRole("option", { name: /小明/ })
    expect(screen.getByLabelText("小明")).toBeInTheDocument()
    expect(option).toHaveTextContent(contact.email)
    await user.click(option)

    expect(onSelectDirectoryItem).toHaveBeenCalledWith(contact)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("describes matched conversation fields", async () => {
    const user = userEvent.setup()
    renderSearch([
      createConversation({
        id: "direct-zhang",
        members: [
          createMember({ id: "current-user", name: "当前用户" }),
          createMember({ email: "zhang@example.com", id: "zhang", name: "张三", nickname: "小张" }),
        ],
        name: "产品搭档",
      }),
    ])

    await openSearch(user)
    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "zhang@example")

    expect(screen.getByRole("option", { name: /产品搭档/ })).toHaveTextContent(
      "匹配邮箱：小张 · zhang@example.com",
    )
  })

  it("supports looping keyboard navigation and exposes the active descendant", async () => {
    const user = userEvent.setup()
    const onSelectConversation = vi.fn()
    renderSearch(
      [
        createConversation({ id: "first", name: "项目一" }),
        createConversation({ id: "second", name: "项目二" }),
      ],
      onSelectConversation,
    )

    await openSearch(user)
    const input = screen.getByRole("combobox", { name: "搜索所有内容" })
    await user.type(input, "项目")
    expect(input).toHaveAttribute("aria-activedescendant", "global-search-option-0")

    await user.keyboard("{ArrowUp}")
    expect(input).toHaveAttribute("aria-activedescendant", "global-search-option-1")
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true")

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")
    expect(onSelectConversation).toHaveBeenCalledWith("second")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await openSearch(user)
    expect(screen.getByRole("combobox", { name: "搜索所有内容" })).toHaveValue("")
  })
})

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "全局搜索" }))
}

function renderSearch(
  conversations: ClientConversation[],
  onSelectConversation = vi.fn(),
  {
    contactApps = [],
    contactGroups = [],
    contacts = [],
    onSelectDirectoryItem = vi.fn(),
  }: {
    contactApps?: ContactApp[]
    contactGroups?: ContactGroup[]
    contacts?: ContactUser[]
    onSelectDirectoryItem?: (item: DirectorySearchItem) => void
  } = {},
) {
  return render(
    <GlobalSearchCommand
      contactApps={contactApps}
      contactGroups={contactGroups}
      contacts={contacts}
      conversations={conversations}
      currentUserId="current-user"
      getConversationDescription={(conversation) => conversation.lastMessageSummary}
      onSelectDirectoryItem={onSelectDirectoryItem}
      onSelectConversation={onSelectConversation}
    />,
  )
}

function createContact(overrides: Partial<ContactUser> = {}): ContactUser {
  return {
    avatar: "",
    email: "contact@example.com",
    id: "contact-1",
    lastOnlineAt: null,
    name: "联系人",
    nickname: "",
    online: true,
    phone: "",
    type: "user",
    ...overrides,
  }
}

function createConversation(overrides: Partial<ClientConversation> = {}): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-01T00:00:00Z",
    id: "conversation-1",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "暂无消息",
    lastReadSeq: 0,
    memberCount: 0,
    members: [],
    name: "普通会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
  }
}

function createMember(overrides: Partial<ClientConversationMember> = {}): ClientConversationMember {
  return {
    avatar: "",
    email: "member@example.com",
    id: "member-1",
    name: "成员",
    nickname: "",
    phone: "",
    role: "member",
    type: "user",
    ...overrides,
  }
}
