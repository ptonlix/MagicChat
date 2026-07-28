import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppLayout } from "@/components/app-layout"
import { LoginPage } from "@/pages/login-page"
import { defaultAppInfo } from "@/lib/app-info"
import { AppInfoContext } from "@/lib/app-info-context"
import { configureDesktopHost } from "@/lib/desktop-host"

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
  vi.clearAllMocks()
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
  it("keeps profile in the avatar menu and moves settings to the sidebar footer", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole("button", { name: "用户菜单" }))

    expect(screen.getByRole("menuitem", { name: /个人资料/ })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: /^设置$/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole("menuitem", { name: /个人资料/ }))

    const profileDialog = await screen.findByRole("dialog", {
      name: "个人资料",
    })
    expect(within(profileDialog).getByLabelText("昵称")).toBeInTheDocument()
    expect(within(profileDialog).queryByText("桌面通知")).not.toBeInTheDocument()

    await user.click(within(profileDialog).getByRole("button", { name: "关闭" }))
    await user.click(screen.getByRole("button", { name: "设置" }))

    const settingsDialog = await screen.findByRole("dialog", { name: "设置" })
    expect(within(settingsDialog).getByText("桌面通知")).toBeInTheDocument()
    expect(within(settingsDialog).queryByLabelText("昵称")).not.toBeInTheDocument()
  })

  it("lets the desktop host handle the shared settings entry", async () => {
    const user = userEvent.setup()
    const openSettings = vi.fn()
    const restoreHost = configureDesktopHost({ openSettings })

    try {
      render(
        <MemoryRouter initialEntries={["/chat"]}>
          <AppLayout />
        </MemoryRouter>,
      )

      await user.click(screen.getByRole("button", { name: "设置" }))

      expect(openSettings).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument()
    } finally {
      restoreHost()
    }
  })

  it("does not show the client download entry in the desktop sidebar", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(screen.queryByRole("button", { name: "下载客户端" })).not.toBeInTheDocument()
  })

  it("opens the MagicChat repository in a new tab", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(screen.getByRole("link", { name: "在 GitHub 查看 MagicChat" })).toMatchObject({
      href: "https://github.com/chaitin/MagicChat",
      rel: "noopener noreferrer",
      target: "_blank",
    })
  })

  it("stays on the login page after logout", async () => {
    const user = userEvent.setup()
    mocks.clientLogout.mockResolvedValue(undefined)

    render(<LogoutFlow />)

    await user.click(screen.getByRole("button", { name: "用户菜单" }))
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }))

    const dialog = await screen.findByRole("alertdialog", {
      name: "确认退出登录",
    })
    await user.click(within(dialog).getByRole("button", { name: "退出登录" }))

    expect(await screen.findByRole("heading", { name: "即应 智能协作平台" })).toBeInTheDocument()
    expect(screen.queryByTestId("init-page")).not.toBeInTheDocument()
    expect(mocks.clientLogout).toHaveBeenCalledTimes(1)
  })
})

function LogoutFlow() {
  const [authenticated, setAuthenticated] = useState(true)

  return (
    <AppInfoContext.Provider
      value={{
        ...defaultAppInfo,
        authenticated,
        setAuthenticated,
      }}
    >
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route element={<AppLayout />} path="/chat" />
          <Route element={<LoginPage />} path="/login" />
          <Route element={<div data-testid="init-page" />} path="/init" />
        </Routes>
      </MemoryRouter>
    </AppInfoContext.Provider>
  )
}
