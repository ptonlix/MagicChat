import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import { ContactDirectorySidebar } from "@/components/contacts/contact-directory-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import type { ContactGroup, ContactUser } from "@/lib/client-data-api"

describe("ContactDirectorySidebar", () => {
  it("shows the organization contacts and hides the current user's message action", async () => {
    const user = userEvent.setup()
    const contacts: ContactUser[] = [
      {
        avatar: "",
        email: "alice@example.com",
        id: "user-1",
        lastOnlineAt: null,
        name: "Alice",
        nickname: "",
        online: true,
        phone: "",
        type: "user",
      },
      {
        avatar: "",
        email: "me@example.com",
        id: "current-user",
        lastOnlineAt: null,
        name: "Me",
        nickname: "",
        online: true,
        phone: "",
        type: "user",
      },
    ]
    render(
      <SidebarProvider>
        <ContactDirectorySidebar
          activeKeyword=""
          activeSelection={{ id: "user-1", type: "user" }}
          activeTab="user"
          apps={[]}
          contacts={contacts}
          contactsRefreshing={false}
          currentUserId="current-user"
          groups={[]}
          organizationName="测试组织"
          onActiveTabChange={vi.fn()}
          onKeywordChange={vi.fn()}
          onRefresh={vi.fn()}
          onSelect={vi.fn()}
          onStartAppConversation={vi.fn()}
          onStartContactConversation={vi.fn()}
          onStartGroupConversation={vi.fn()}
          openingDirectoryItemKey=""
        />
      </SidebarProvider>
    )

    const organizationTrigger = screen.getByRole("button", {
      name: "测试组织",
    })
    expect(organizationTrigger).toHaveTextContent("测试组织2")
    expect(
      organizationTrigger.closest('[data-slot="collapsible"]')
    ).toHaveClass("border")
    expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "与 Alice 对话" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "与 Me 对话" })
    ).not.toBeInTheDocument()
    expect(organizationTrigger).toHaveAttribute("aria-expanded", "true")

    await user.click(organizationTrigger)
    expect(
      screen.queryByRole("option", { name: "Alice" })
    ).not.toBeInTheDocument()
    expect(organizationTrigger).toBeInTheDocument()
  })

  it("groups joined and unjoined public groups into collapsible sections", async () => {
    const user = userEvent.setup()
    const groups: ContactGroup[] = [
      createGroup("joined-group", "已加入群", true, "private"),
      createGroup("public-group", "公开群", false, "public"),
      createGroup("private-group", "未加入私有群", false, "private"),
    ]

    render(
      <SidebarProvider>
        <ContactDirectorySidebar
          activeKeyword=""
          activeSelection={null}
          activeTab="group"
          apps={[]}
          contacts={[]}
          contactsRefreshing={false}
          currentUserId="current-user"
          groups={groups}
          organizationName="测试组织"
          onActiveTabChange={vi.fn()}
          onKeywordChange={vi.fn()}
          onRefresh={vi.fn()}
          onSelect={vi.fn()}
          onStartAppConversation={vi.fn()}
          onStartContactConversation={vi.fn()}
          onStartGroupConversation={vi.fn()}
          openingDirectoryItemKey=""
        />
      </SidebarProvider>
    )

    const joinedTrigger = screen.getByRole("button", { name: "我加入的" })
    const publicTrigger = screen.getByRole("button", { name: "公开群组" })
    expect(joinedTrigger).toHaveTextContent("我加入的1")
    expect(publicTrigger).toHaveTextContent("公开群组1")
    expect(joinedTrigger).toHaveAttribute("aria-expanded", "true")
    expect(publicTrigger).toHaveAttribute("aria-expanded", "true")
    const joinedGroupItem = screen.getByRole("option", { name: "已加入群" })
    expect(joinedGroupItem).toBeInTheDocument()
    expect(joinedGroupItem.querySelectorAll("img")).toHaveLength(2)
    expect(screen.getByRole("option", { name: "公开群" })).toBeInTheDocument()
    expect(
      screen.queryByRole("option", { name: "未加入私有群" })
    ).not.toBeInTheDocument()

    await user.click(joinedTrigger)
    expect(
      screen.queryByRole("option", { name: "已加入群" })
    ).not.toBeInTheDocument()
  })

  it("preserves the section state while search forces matching contacts open", async () => {
    const user = userEvent.setup()
    const props = createSidebarProps({
      contacts: [
        {
          avatar: "",
          email: "alice@example.com",
          id: "user-1",
          lastOnlineAt: null,
          name: "Alice",
          nickname: "",
          online: true,
          phone: "",
          type: "user",
        },
      ],
    })
    const view = render(
      <SidebarProvider>
        <ContactDirectorySidebar {...props} />
      </SidebarProvider>
    )
    const organizationTrigger = screen.getByRole("button", {
      name: "测试组织",
    })

    view.rerender(
      <SidebarProvider>
        <ContactDirectorySidebar {...props} activeKeyword="alice" />
      </SidebarProvider>
    )
    await user.click(organizationTrigger)
    expect(organizationTrigger).toHaveAttribute("aria-expanded", "true")

    view.rerender(
      <SidebarProvider>
        <ContactDirectorySidebar {...props} activeKeyword="" />
      </SidebarProvider>
    )
    expect(organizationTrigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument()
  })
})

function createSidebarProps(
  overrides: Partial<ComponentProps<typeof ContactDirectorySidebar>> = {}
): ComponentProps<typeof ContactDirectorySidebar> {
  return {
    activeKeyword: "",
    activeSelection: null,
    activeTab: "user",
    apps: [],
    contacts: [],
    contactsRefreshing: false,
    currentUserId: "current-user",
    groups: [],
    organizationName: "测试组织",
    onActiveTabChange: vi.fn(),
    onKeywordChange: vi.fn(),
    onRefresh: vi.fn(),
    onSelect: vi.fn(),
    onStartAppConversation: vi.fn(),
    onStartContactConversation: vi.fn(),
    onStartGroupConversation: vi.fn(),
    openingDirectoryItemKey: "",
    ...overrides,
  }
}

function createGroup(
  id: string,
  name: string,
  joined: boolean,
  visibility: ContactGroup["visibility"]
): ContactGroup {
  return {
    avatar: "",
    avatarMembers: joined
      ? [
          {
            avatar: "/alice.webp",
            name: "Alice",
            nickname: "",
            role: "owner",
          },
          {
            avatar: "/bob.webp",
            name: "Bob",
            nickname: "",
            role: "member",
          },
        ]
      : [],
    id,
    joined,
    memberCount: 1,
    name,
    type: "group",
    visibility,
  }
}
