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
  ClientDataProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="chat-data-provider">{children}</div>
  ),
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
vi.mock("@/pages/document-route", () => ({
  default: () => <main>文档工作区</main>,
}))

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

  it("主窗口文档路由保留聊天宿主但不经过普通布局", async () => {
    renderApp("/documents/document/550e8400-e29b-41d4-a716-446655440000")

    expect(await screen.findByText("文档工作区")).toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "应用侧边栏" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新版本" })).not.toBeInTheDocument()
    expect(screen.getByTestId("chat-data-provider")).toBeInTheDocument()
  })

  it("子窗口离开文档路由时回到当前文档，不挂载聊天页面", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <App
          documentWindow={{
            documentId: "550e8400-e29b-41d4-a716-446655440000",
            mode: "document",
            serverId: "server-1",
          }}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText("文档工作区")).toBeInTheDocument()
    expect(screen.queryByText("项目页面")).not.toBeInTheDocument()
    expect(screen.queryByTestId("chat-data-provider")).not.toBeInTheDocument()
  })
})

function renderApp(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <App updatePrompt={<button type="button">新版本</button>} />
    </MemoryRouter>,
  )
}
