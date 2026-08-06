import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ClientDataRequestError } from "@/lib/client-data-api"
import { ClientDataContext, type ClientDataContextValue } from "@/lib/client-data-context"
import { useDocumentData } from "@/lib/document-data-context"
import { DocumentDataProvider } from "./document-data-provider"

const mocks = vi.hoisted(() => ({
  getCurrentClientUser: vi.fn(),
  listClientProjects: vi.fn(),
  setAuthenticated: vi.fn(),
}))

vi.mock("@/components/client-document-title", () => ({ ClientDocumentTitle: () => null }))
vi.mock("@/lib/app-info-context", () => ({
  useAppInfo: () => ({ setAuthenticated: mocks.setAuthenticated }),
}))
vi.mock("@/lib/client-data-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-data-api")>()),
  getCurrentClientUser: mocks.getCurrentClientUser,
}))
vi.mock("@/lib/project-data-api", () => ({ listClientProjects: mocks.listClientProjects }))

function Probe() {
  const { me } = useDocumentData()
  return <span>当前用户：{me.id}</span>
}

describe("DocumentDataProvider", () => {
  it("只加载当前用户和项目数据，不启动聊天数据管线", async () => {
    mocks.getCurrentClientUser.mockReset().mockResolvedValue({ id: "user-1" })
    mocks.listClientProjects.mockReset().mockResolvedValue({
      nextCursor: null,
      personalProject: { id: "personal" },
      projects: [],
    })

    render(
      <DocumentDataProvider>
        <Probe />
      </DocumentDataProvider>,
    )

    expect(await screen.findByText("当前用户：user-1")).toBeInTheDocument()
    expect(mocks.getCurrentClientUser).toHaveBeenCalledOnce()
    expect(mocks.listClientProjects).toHaveBeenCalledWith({ limit: 100 })
    expect(mocks.setAuthenticated).toHaveBeenCalledWith(true)
  })

  it("401 只展示文档工作区认证错误并提供重试，不跳转聊天登录路由", async () => {
    mocks.getCurrentClientUser
      .mockReset()
      .mockRejectedValue(
        new ClientDataRequestError("登录已失效", { code: "unauthorized", status: 401 }),
      )
    mocks.listClientProjects.mockReset().mockResolvedValue({
      nextCursor: null,
      personalProject: { id: "personal" },
      projects: [],
    })

    render(
      <DocumentDataProvider>
        <Probe />
      </DocumentDataProvider>,
    )

    expect(
      await screen.findByText("当前登录状态已失效，请重新登录后再打开文档。"),
    ).toBeInTheDocument()
    expect(mocks.setAuthenticated).toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.queryByText("当前用户：user-1")).not.toBeInTheDocument())
  })

  it("主窗口已有聊天数据上下文时复用当前用户而不重复请求", async () => {
    mocks.getCurrentClientUser.mockReset()
    mocks.listClientProjects.mockReset()
    const refreshMe = vi.fn()
    const refreshProjects = vi.fn()
    const clientData = {
      me: { id: "user-1" },
      refreshMe,
      refreshProjects,
    } as unknown as ClientDataContextValue

    render(
      <ClientDataContext.Provider value={clientData}>
        <DocumentDataProvider>
          <Probe />
        </DocumentDataProvider>
      </ClientDataContext.Provider>,
    )

    expect(screen.getByText("当前用户：user-1")).toBeInTheDocument()
    expect(mocks.getCurrentClientUser).not.toHaveBeenCalled()
    expect(mocks.listClientProjects).not.toHaveBeenCalled()
  })
})
