import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
  const { loadMoreProjects, me, personalProject, projects, projectsNextCursor, refreshProjects } =
    useDocumentData()
  return (
    <div>
      <span>当前用户：{me.id}</span>
      <span>个人项目：{personalProject.name}</span>
      <span>项目列表：{projects.map((project) => project.name).join("、")}</span>
      <span>下一页：{projectsNextCursor ?? "无"}</span>
      <button onClick={() => void loadMoreProjects()} type="button">
        加载更多
      </button>
      <button onClick={() => void refreshProjects()} type="button">
        刷新项目
      </button>
    </div>
  )
}

describe("DocumentDataProvider", () => {
  it("只加载当前用户和项目数据，不启动聊天数据管线", async () => {
    mocks.getCurrentClientUser.mockReset().mockResolvedValue({ id: "user-1" })
    mocks.listClientProjects.mockReset().mockResolvedValue({
      nextCursor: null,
      personalProject: projectFixture("personal", "个人项目", true),
      projects: [projectFixture("project-1", "项目一")],
    })

    render(
      <DocumentDataProvider>
        <Probe />
      </DocumentDataProvider>,
    )

    expect(await screen.findByText("当前用户：user-1")).toBeInTheDocument()
    expect(screen.getByText("个人项目：个人项目")).toBeInTheDocument()
    expect(screen.getByText("项目列表：项目一")).toBeInTheDocument()
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
      personalProject: projectFixture("personal", "个人项目", true),
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
    const loadMoreProjects = vi.fn()
    const clientData = {
      loadMoreProjects,
      me: { id: "user-1" },
      personalProject: projectFixture("personal", "个人项目", true),
      projects: [projectFixture("project-1", "项目一")],
      projectsLoadingMore: false,
      projectsNextCursor: "cursor-2",
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
    expect(screen.getByText("项目列表：项目一")).toBeInTheDocument()
    expect(screen.getByText("下一页：cursor-2")).toBeInTheDocument()
    expect(mocks.getCurrentClientUser).not.toHaveBeenCalled()
    expect(mocks.listClientProjects).not.toHaveBeenCalled()
  })

  it("独立文档窗口按游标加载并去重合并更多项目", async () => {
    const user = userEvent.setup()
    mocks.getCurrentClientUser.mockReset().mockResolvedValue({ id: "user-1" })
    mocks.listClientProjects
      .mockReset()
      .mockResolvedValueOnce({
        nextCursor: "cursor-2",
        personalProject: projectFixture("personal", "个人项目", true),
        projects: [projectFixture("project-1", "项目一")],
      })
      .mockResolvedValueOnce({
        nextCursor: null,
        personalProject: projectFixture("personal", "个人项目", true),
        projects: [
          projectFixture("project-1", "项目一（更新）"),
          projectFixture("project-2", "项目二"),
        ],
      })

    render(
      <DocumentDataProvider>
        <Probe />
      </DocumentDataProvider>,
    )

    await user.click(await screen.findByRole("button", { name: "加载更多" }))

    expect(await screen.findByText("项目列表：项目一（更新）、项目二")).toBeInTheDocument()
    expect(screen.getByText("下一页：无")).toBeInTheDocument()
    expect(mocks.listClientProjects).toHaveBeenLastCalledWith({
      cursor: "cursor-2",
      limit: 100,
    })
  })

  it("刷新与加载更多乱序完成时忽略旧分页结果", async () => {
    const user = userEvent.setup()
    const pagination = deferred<ReturnType<typeof projectPageFixture>>()
    const refresh = deferred<ReturnType<typeof projectPageFixture>>()
    mocks.getCurrentClientUser.mockReset().mockResolvedValue({ id: "user-1" })
    mocks.listClientProjects
      .mockReset()
      .mockResolvedValueOnce(
        projectPageFixture("cursor-2", [projectFixture("project-1", "旧项目")]),
      )
      .mockReturnValueOnce(pagination.promise)
      .mockReturnValueOnce(refresh.promise)

    render(
      <DocumentDataProvider>
        <Probe />
      </DocumentDataProvider>,
    )
    await screen.findByText("项目列表：旧项目")

    await user.click(screen.getByRole("button", { name: "加载更多" }))
    await waitFor(() => expect(mocks.listClientProjects).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole("button", { name: "刷新项目" }))
    await waitFor(() => expect(mocks.listClientProjects).toHaveBeenCalledTimes(3))

    refresh.resolve(projectPageFixture("fresh-cursor", [projectFixture("project-3", "刷新项目")]))
    expect(await screen.findByText("项目列表：刷新项目")).toBeInTheDocument()
    expect(screen.getByText("下一页：fresh-cursor")).toBeInTheDocument()

    pagination.resolve(
      projectPageFixture("stale-cursor", [projectFixture("project-2", "过期分页项目")]),
    )
    await waitFor(() => expect(screen.getByText("项目列表：刷新项目")).toBeInTheDocument())
    expect(screen.queryByText(/过期分页项目/)).not.toBeInTheDocument()
    expect(screen.getByText("下一页：fresh-cursor")).toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function projectPageFixture(
  nextCursor: string | null,
  projects: ReturnType<typeof projectFixture>[],
) {
  return {
    nextCursor,
    personalProject: projectFixture("personal", "个人项目", true),
    projects,
  }
}

function projectFixture(id: string, name: string, isPersonal = false) {
  return {
    avatar: "",
    description: "",
    id,
    isPersonal,
    name,
    updatedAt: "2026-08-19T00:00:00Z",
  }
}
