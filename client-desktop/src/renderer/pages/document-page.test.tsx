import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  attachProvider: vi.fn(),
  createClientDocument: vi.fn(),
  destroyProvider: vi.fn(),
  destroyWebsocketProvider: vi.fn(),
  getClientDocument: vi.fn(),
  getClientProject: vi.fn(),
  listClientDocuments: vi.fn(),
  providerOptions: undefined as
    | { onClose?: (event: { event: { code: number } }) => void }
    | undefined,
  refreshMe: vi.fn(),
  refreshProjects: vi.fn(),
  updateCollaborativeDocumentTitle: vi.fn(),
}))

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    private readonly onSynced?: (event: { state: boolean }) => void

    constructor(options: {
      onClose?: (event: { event: { code: number } }) => void
      onSynced?: (event: { state: boolean }) => void
    }) {
      this.onSynced = options.onSynced
      mocks.providerOptions = options
    }
    attach() {
      mocks.attachProvider()
      queueMicrotask(() => this.onSynced?.({ state: true }))
    }
    destroy() {
      mocks.destroyProvider()
    }
  },
  HocuspocusProviderWebsocket: class {
    destroy() {
      mocks.destroyWebsocketProvider()
    }
  },
  WebSocketStatus: { Connecting: "connecting", Disconnected: "disconnected" },
}))
vi.mock("@/components/client-document-title", () => ({ ClientDocumentTitle: () => null }))
vi.mock("@/components/documents/document-editor", () => ({
  DocumentEditor: ({
    onTitleChange,
    title,
  }: {
    onTitleChange(value: string): void
    title: string
  }) => (
    <input
      aria-label="文档页面标题"
      onChange={(event) => onTitleChange(event.target.value)}
      value={title}
    />
  ),
}))
vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({ refreshMe: mocks.refreshMe, refreshProjects: mocks.refreshProjects }),
}))
vi.mock("@/lib/document-data-api", () => ({
  createClientDocument: mocks.createClientDocument,
  getClientDocument: mocks.getClientDocument,
  listClientDocuments: mocks.listClientDocuments,
  updateCollaborativeDocumentTitle: mocks.updateCollaborativeDocumentTitle,
}))
vi.mock("@/lib/project-data-api", () => ({ getClientProject: mocks.getClientProject }))

import { DesktopTargetContext } from "@/lib/desktop-target-context"
import { DocumentPage } from "./document-page"

const document = {
  createdAt: "2026-08-04T09:00:00Z",
  creator: { avatar: "", id: "user-1", name: "陈富东", nickname: "" },
  documentType: "document",
  id: "4457c4af-2185-4e8e-b267-38f25ac3dd2f",
  kind: "document",
  parentId: null,
  projectId: "project-1",
  schemaVersion: 1,
  sortOrder: 0,
  title: "陈富东测试",
  updatedAt: "2026-08-04T09:00:00Z",
  updatedBy: { avatar: "", id: "user-1", name: "陈富东", nickname: "" },
} as const

const project = {
  avatar: "",
  createdAt: "2026-08-04T09:00:00Z",
  currentUserRole: "owner",
  description: "",
  groupCount: 0,
  id: "project-1",
  isPersonal: false,
  memberCount: 1,
  name: "即应产品迭代",
  owner: { avatar: "", id: "user-1", name: "陈富东", nickname: "" },
  taskCounts: { canceled: 0, done: 0, inProgress: 0, todo: 0, total: 0 },
  updatedAt: "2026-08-04T09:00:00Z",
} as const

describe("DocumentPage", () => {
  beforeEach(() => {
    mocks.attachProvider.mockReset()
    mocks.destroyProvider.mockReset()
    mocks.destroyWebsocketProvider.mockReset()
    mocks.getClientDocument.mockReset().mockResolvedValue(document)
    mocks.getClientProject.mockReset().mockResolvedValue(project)
    mocks.listClientDocuments.mockReset().mockResolvedValue([document])
    mocks.providerOptions = undefined
    mocks.refreshMe.mockReset().mockResolvedValue(undefined)
    mocks.refreshProjects.mockReset().mockResolvedValue(undefined)
    mocks.updateCollaborativeDocumentTitle.mockReset().mockResolvedValue(document.title)
  })

  afterEach(() => vi.clearAllMocks())

  it("避开 Desktop 标题栏并同时展示返回入口、文档标题和同步状态", async () => {
    renderPage()

    const title = await screen.findByRole("textbox", { name: "顶部文档标题" })
    expect(title).toHaveValue("陈富东测试")
    expect(title).not.toHaveAttribute("maxlength")
    expect(title.closest("main")).toHaveClass("h-svh", "pt-10")
    expect(screen.getByRole("link", { name: "返回项目：即应产品迭代" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    )
    await waitFor(() => expect(screen.getByText(/标题已自动保存.*正文已同步/)).toBeInTheDocument())
    expect(mocks.attachProvider).toHaveBeenCalledOnce()
  })

  it("统一拦截应用内路由导航，取消时保留编辑状态，确认后才离开", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    const router = renderPage()
    fireEvent.change(await screen.findByRole("textbox", { name: "顶部文档标题" }), {
      target: { value: "尚未保存的标题" },
    })

    await router.navigate("/projects/project-1")
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(router.state.location.pathname).toBe(`/documents/document/${document.id}`)
    expect(screen.getByRole("textbox", { name: "顶部文档标题" })).toHaveValue("尚未保存的标题")

    await router.navigate("/projects/project-1")
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects/project-1"))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it("新建文档等待期间继续编辑时再次确认，取消后保留当前页面", async () => {
    let resolveCreate: ((value: unknown) => void) | undefined
    mocks.createClientDocument.mockReset().mockReturnValue(
      new Promise<unknown>((resolve) => {
        resolveCreate = resolve
      }),
    )
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    const router = renderPage()
    await screen.findByRole("textbox", { name: "顶部文档标题" })

    fireEvent.click(screen.getByRole("button", { name: "新建文档" }))
    fireEvent.change(screen.getByRole("textbox", { name: "顶部文档标题" }), {
      target: { value: "请求期间的新修改" },
    })
    resolveCreate?.({ ...document, id: "5457c4af-2185-4e8e-b267-38f25ac3dd2f" })

    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(router.state.location.pathname).toBe(`/documents/document/${document.id}`)
    expect(screen.getByRole("textbox", { name: "顶部文档标题" })).toHaveValue("请求期间的新修改")
  })

  it("文档权限被撤销时刷新项目和当前用户，但不触发全局注销", async () => {
    renderPage()
    await screen.findByRole("textbox", { name: "顶部文档标题" })

    mocks.providerOptions?.onClose?.({ event: { code: 4403 } })

    expect(await screen.findByText(/当前账号无权访问该文档/)).toBeVisible()
    await waitFor(() => {
      expect(mocks.refreshProjects).toHaveBeenCalledOnce()
      expect(mocks.refreshMe).toHaveBeenCalledOnce()
    })
    expect(mocks.destroyProvider).toHaveBeenCalledOnce()
    expect(mocks.destroyWebsocketProvider).toHaveBeenCalledOnce()

    mocks.providerOptions?.onClose?.({ event: { code: 4403 } })
    expect(mocks.destroyProvider).toHaveBeenCalledOnce()
    expect(mocks.destroyWebsocketProvider).toHaveBeenCalledOnce()
  })
})

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/documents/document/:documentId",
        element: <DocumentPage />,
      },
      { path: "/projects/:projectId", element: <div>项目页面</div> },
    ],
    { initialEntries: [`/documents/document/${document.id}`] },
  )
  render(
    <DesktopTargetContext.Provider
      value={{ id: "server-1", normalizedUrl: "https://chat.example.com", userId: "user-1" }}
    >
      <RouterProvider router={router} />
    </DesktopTargetContext.Provider>,
  )
  return router
}
