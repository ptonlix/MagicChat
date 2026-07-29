import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { MemoryRouter, Outlet } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { App } from "./App"

vi.mock("@/components/app-info-provider", () => ({
  AppInfoProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/client-brand-metadata", () => ({ ClientBrandMetadata: () => null }))
vi.mock("@/components/client-conversation-realtime-sync", () => ({
  ClientConversationRealtimeSync: () => null,
}))
vi.mock("@/components/client-data-provider", () => ({
  ClientDataProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/client-document-title", () => ({ ClientDocumentTitle: () => null }))
vi.mock("@/components/client-message-notification-sync", () => ({
  ClientMessageNotificationSync: () => null,
}))
vi.mock("@/components/client-realtime-provider", () => ({
  ClientRealtimeProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/app-layout", () => ({
  AppLayout: ({ footerAction }: { footerAction?: ReactNode }) => (
    <aside aria-label="应用侧边栏">
      <Outlet />
      {footerAction}
    </aside>
  ),
}))
vi.mock("@/pages/chat-page", () => ({ ChatPage: () => <div>聊天页面</div> }))
vi.mock("@/pages/contacts-page", () => ({ ContactsPage: () => null }))
vi.mock("@/pages/login-page", () => ({ LoginPage: () => <div>登录页面</div> }))
vi.mock("@/pages/projects-page", () => ({ ProjectsPage: () => null }))

describe("桌面更新入口路由边界", () => {
  it("登录页不展示更新入口", () => {
    renderApp("/login")

    expect(screen.getByText("登录页面")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新版本" })).not.toBeInTheDocument()
  })

  it("主工作区在侧边栏展示更新入口", () => {
    renderApp("/chat")

    expect(screen.getByText("聊天页面")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "新版本" }).closest("aside")).toHaveAccessibleName(
      "应用侧边栏",
    )
  })
})

function renderApp(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <App updatePrompt={<button type="button">新版本</button>} />
    </MemoryRouter>,
  )
}
