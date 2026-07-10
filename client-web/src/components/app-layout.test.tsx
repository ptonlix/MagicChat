import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppLayout } from "@/components/app-layout"

const mocks = vi.hoisted(() => ({
  clientData: {
    conversations: [] as Array<{ unreadCount: number }>,
    me: {
      avatar: "",
      createdAt: "2026-07-09T00:00:00Z",
      email: "me@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "张三",
      nickname: "三三",
      phone: "",
      status: "active",
    },
    refreshMe: vi.fn(),
  },
  clientLogout: vi.fn(),
  setTheme: vi.fn(),
  updateCurrentClientUser: vi.fn(),
  uploadCurrentClientAvatar: vi.fn(),
}))

beforeEach(() => {
  mocks.clientData.conversations = []
})

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => mocks.clientData,
}))

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    setTheme: mocks.setTheme,
    theme: "system",
  }),
}))

vi.mock("@/lib/client-auth", () => ({
  clientLogout: mocks.clientLogout,
}))

vi.mock("@/lib/client-data-api", () => ({
  updateCurrentClientUser: mocks.updateCurrentClientUser,
  uploadCurrentClientAvatar: mocks.uploadCurrentClientAvatar,
}))

describe("AppLayout", () => {
  it("shows a notification dot when any conversation is unread", () => {
    mocks.clientData.conversations = [
      { unreadCount: 0 },
      { unreadCount: 2 },
    ]

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    const chatLink = screen.getByRole("link", {
      name: "聊天，有未读消息",
    })

    expect(
      chatLink.querySelector('[data-slot="notification-dot"]')
    ).toBeInTheDocument()
  })

  it("hides the notification dot when every conversation is read", () => {
    mocks.clientData.conversations = [
      { unreadCount: 0 },
      { unreadCount: 0 },
    ]

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    const chatLink = screen.getByRole("link", { name: "聊天" })

    expect(
      chatLink.querySelector('[data-slot="notification-dot"]')
    ).not.toBeInTheDocument()
  })

  it("positions the notification dot inward from the button edge", () => {
    mocks.clientData.conversations = [{ unreadCount: 1 }]

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    const chatLink = screen.getByRole("link", {
      name: "聊天，有未读消息",
    })
    const notificationDot = chatLink.querySelector(
      '[data-slot="notification-dot"]'
    )

    expect(notificationDot).toHaveClass("top-1", "right-1")
  })

  it("does not flash unread messages already present on initial load", () => {
    mocks.clientData.conversations = [{ unreadCount: 2 }]

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    const notificationDot = screen
      .getByRole("link", { name: "聊天，有未读消息" })
      .querySelector('[data-slot="notification-dot"]')

    expect(notificationDot).not.toHaveClass("notification-dot-flash")
  })

  it("flashes when the global unread total increases", () => {
    mocks.clientData.conversations = [{ unreadCount: 0 }]
    const view = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    mocks.clientData.conversations = [{ unreadCount: 1 }]
    view.rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    const notificationDot = screen
      .getByRole("link", { name: "聊天，有未读消息" })
      .querySelector('[data-slot="notification-dot"]')

    expect(notificationDot).toHaveClass("notification-dot-flash")
  })

  it("restarts the flash when another unread message arrives", () => {
    mocks.clientData.conversations = [{ unreadCount: 0 }]
    const view = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    mocks.clientData.conversations = [{ unreadCount: 1 }]
    view.rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )
    const firstDot = screen
      .getByRole("link", { name: "聊天，有未读消息" })
      .querySelector('[data-slot="notification-dot"]')

    mocks.clientData.conversations = [{ unreadCount: 2 }]
    view.rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )
    const restartedDot = screen
      .getByRole("link", { name: "聊天，有未读消息" })
      .querySelector('[data-slot="notification-dot"]')

    expect(restartedDot).not.toBe(firstDot)
    expect(restartedDot).toHaveClass("notification-dot-flash")
  })

  it("returns the dot to its static state when the flash ends", () => {
    mocks.clientData.conversations = [{ unreadCount: 0 }]
    const view = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    mocks.clientData.conversations = [{ unreadCount: 1 }]
    view.rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )
    const notificationDot = screen
      .getByRole("link", { name: "聊天，有未读消息" })
      .querySelector('[data-slot="notification-dot"]')

    expect(notificationDot).toHaveClass("notification-dot-flash")
    // JSDOM lacks AnimationEvent, so React registers its WebKit fallback.
    fireEvent(
      notificationDot!,
      new Event("webkitAnimationEnd", { bubbles: true })
    )
    expect(notificationDot).not.toHaveClass("notification-dot-flash")
  })

  it("does not flash when the global unread total decreases", () => {
    mocks.clientData.conversations = [{ unreadCount: 2 }]
    const view = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    mocks.clientData.conversations = [{ unreadCount: 1 }]
    view.rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    const notificationDot = screen
      .getByRole("link", { name: "聊天，有未读消息" })
      .querySelector('[data-slot="notification-dot"]')

    expect(notificationDot).not.toHaveClass("notification-dot-flash")
  })

  it("does not flash when a message leaves the global unread total unchanged", () => {
    mocks.clientData.conversations = [{ unreadCount: 1 }]
    const view = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    mocks.clientData.conversations = [{ unreadCount: 1 }]
    view.rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    const notificationDot = screen
      .getByRole("link", { name: "聊天，有未读消息" })
      .querySelector('[data-slot="notification-dot"]')

    expect(notificationDot).not.toHaveClass("notification-dot-flash")
  })

  it("splits profile and settings actions in the user avatar menu", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    await user.click(screen.getByRole("button", { name: "用户菜单" }))

    expect(screen.getByRole("menuitem", { name: /个人资料/ })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /第三方账号/ })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /^设置$/ })).toBeInTheDocument()

    await user.click(screen.getByRole("menuitem", { name: /个人资料/ }))

    const profileDialog = await screen.findByRole("dialog", {
      name: "个人资料",
    })
    expect(within(profileDialog).getByLabelText("昵称")).toBeInTheDocument()
    expect(within(profileDialog).queryByText("桌面通知")).not.toBeInTheDocument()

    await user.click(within(profileDialog).getByRole("button", { name: "关闭" }))
    await user.click(screen.getByRole("button", { name: "用户菜单" }))
    await user.click(screen.getByRole("menuitem", { name: /^设置$/ }))

    const settingsDialog = await screen.findByRole("dialog", { name: "设置" })
    expect(within(settingsDialog).getByText("桌面通知")).toBeInTheDocument()
    expect(within(settingsDialog).queryByLabelText("昵称")).not.toBeInTheDocument()
  })
})
