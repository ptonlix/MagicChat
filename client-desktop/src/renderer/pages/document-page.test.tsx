import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

const mocks = vi.hoisted(() => ({
  attachProvider: vi.fn(),
  createClientDocument: vi.fn(),
  destroyProvider: vi.fn(),
  destroyWebsocketProvider: vi.fn(),
  getClientDocument: vi.fn(),
  getClientProject: vi.fn(),
  listClientDocuments: vi.fn(),
  passedCollaborationProvider: undefined as unknown,
  providerOptions: undefined as
    | {
        document?: Y.Doc
        onAwarenessChange?: (event: { states: unknown[] }) => void
        onClose?: (event: { event: { code: number } }) => void
      }
    | undefined,
  currentRefreshMe: undefined as unknown as () => Promise<void>,
  currentRefreshProjects: undefined as unknown as () => Promise<void>,
  currentMe: undefined as
    | { avatar: string; id: string; name: string; nickname: string }
    | undefined,
  refreshMe: vi.fn(),
  refreshProjects: vi.fn(),
  setAwarenessField: vi.fn(),
  updateCollaborativeDocumentTitle: vi.fn(),
}))

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    private readonly onSynced?: (event: { state: boolean }) => void

    constructor(options: {
      document?: Y.Doc
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
    setAwarenessField(field: string, value: unknown) {
      mocks.setAwarenessField(field, value)
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
    collaborationProvider,
    onTitleChange,
    title,
  }: {
    collaborationProvider?: unknown
    onTitleChange(value: string): void
    title: string
  }) => {
    mocks.passedCollaborationProvider = collaborationProvider
    return (
      <input
        aria-label="文档页面标题"
        onChange={(event) => onTitleChange(event.target.value)}
        value={title}
      />
    )
  },
}))
vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    me: mocks.currentMe,
    refreshMe: mocks.currentRefreshMe,
    refreshProjects: mocks.currentRefreshProjects,
  }),
}))
vi.mock("@/lib/document-data-context", () => ({
  useDocumentData: () => ({
    me: mocks.currentMe,
    refreshMe: mocks.currentRefreshMe,
    refreshProjects: mocks.currentRefreshProjects,
  }),
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
    mocks.passedCollaborationProvider = undefined
    mocks.providerOptions = undefined
    mocks.currentMe = { avatar: "", id: "user-1", name: "陈富东", nickname: "" }
    mocks.refreshMe.mockReset().mockResolvedValue(undefined)
    mocks.refreshProjects.mockReset().mockResolvedValue(undefined)
    mocks.currentRefreshMe = mocks.refreshMe
    mocks.currentRefreshProjects = mocks.refreshProjects
    mocks.updateCollaborativeDocumentTitle.mockReset().mockResolvedValue(document.title)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("避开 Desktop 标题栏并同时展示返回入口、文档标题和同步状态", async () => {
    renderPage()

    const title = await screen.findByRole("textbox", { name: "顶部文档标题" })
    expect(title).toHaveValue("陈富东测试")
    expect(title).not.toHaveAttribute("maxlength")
    expect(title.closest("main")).toHaveClass("h-svh", "pt-10")
    expect(title.closest("main")).not.toHaveClass("no-drag")
    expect(screen.getByRole("link", { name: "返回项目：即应产品迭代" })).toHaveAttribute(
      "href",
      "/projects/project-1/documents",
    )
    await waitFor(() => expect(screen.getByText(/标题已自动保存.*正文已同步/)).toBeInTheDocument())
    expect(mocks.attachProvider).toHaveBeenCalledOnce()
    expect(mocks.passedCollaborationProvider).toBeDefined()
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

  it("标题区的新窗口入口等待 Bridge 成功后返回项目文档列表", async () => {
    const openDocumentWindow = vi.fn().mockResolvedValue({
      ok: true,
      result: { status: "created" },
    })
    vi.stubGlobal("desktop", { navigation: { openDocumentWindow } })
    const router = renderPage()
    await screen.findByRole("textbox", { name: "顶部文档标题" })

    expect(
      screen
        .getByRole("button", { name: "打开新窗口并返回" })
        .querySelector("svg.lucide-app-window"),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "打开当前文档并返回" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "打开新窗口并返回" }))
    await waitFor(() => expect(openDocumentWindow).toHaveBeenCalledWith(document.id, "server-1"))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/project-1/documents"),
    )
  })

  it("子窗口中的新窗口入口只聚焦文档，不改变当前路由", async () => {
    const initialUrl = window.location.href
    window.history.pushState(
      {},
      "",
      `/documents/document/${document.id}?serverId=server-1&window=document`,
    )
    const openDocumentWindow = vi.fn().mockResolvedValue({
      ok: true,
      result: { status: "focused" },
    })
    vi.stubGlobal("desktop", { navigation: { openDocumentWindow } })
    try {
      const router = renderPage()
      await screen.findByRole("textbox", { name: "顶部文档标题" })

      fireEvent.click(screen.getByRole("button", { name: "在新窗口打开文档" }))
      await waitFor(() => expect(openDocumentWindow).toHaveBeenCalledWith(document.id, "server-1"))
      expect(router.state.location.pathname).toBe(`/documents/document/${document.id}`)
    } finally {
      window.history.pushState({}, "", initialUrl)
    }
  })

  it("发布并消费 awareness，在正常卸载时清空在线状态并销毁 Provider", async () => {
    const router = renderPage()
    await screen.findByRole("textbox", { name: "顶部文档标题" })
    await waitFor(() => expect(mocks.passedCollaborationProvider).toBeDefined())
    expect(mocks.setAwarenessField).toHaveBeenCalledWith(
      "user",
      expect.objectContaining({ id: "user-1", name: "陈富东" }),
    )

    act(() => {
      mocks.providerOptions?.onAwarenessChange?.({
        states: [
          { clientId: 1, user: { color: "#112233", id: "user-2", name: "李四" } },
          { clientId: 2, user: { color: "invalid", id: "user-2", name: "重复李四" } },
        ],
      })
    })
    expect(await screen.findByRole("button", { name: "查看 1 位在线成员" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "重复李四" })).toHaveStyle({
      outline: "2px solid #64748b",
    })

    await router.navigate("/projects/project-1")
    await waitFor(() => {
      expect(mocks.destroyProvider).toHaveBeenCalledOnce()
      expect(mocks.destroyWebsocketProvider).toHaveBeenCalledOnce()
    })
  })

  it("全局刷新函数引用变化时保持当前协作 Provider，避免编辑器和图片重复挂载", async () => {
    renderPage()
    await screen.findByRole("textbox", { name: "文档页面标题" })
    await waitFor(() => expect(mocks.attachProvider).toHaveBeenCalledOnce())

    mocks.currentRefreshMe = vi.fn().mockResolvedValue(undefined)
    mocks.currentRefreshProjects = vi.fn().mockResolvedValue(undefined)
    act(() => {
      mocks.providerOptions?.onAwarenessChange?.({
        states: [{ clientId: 1, user: { color: "#112233", id: "user-2", name: "李四" } }],
      })
    })
    await screen.findByRole("button", { name: "查看 1 位在线成员" })

    expect(mocks.attachProvider).toHaveBeenCalledOnce()
    expect(mocks.destroyProvider).not.toHaveBeenCalled()
    expect(mocks.destroyWebsocketProvider).not.toHaveBeenCalled()
  })

  it("当前用户资料变化时只更新 awareness，不重建协作 Provider", async () => {
    renderPage()
    await screen.findByRole("textbox", { name: "文档页面标题" })
    await waitFor(() => expect(mocks.attachProvider).toHaveBeenCalledOnce())

    mocks.currentMe = {
      avatar: "/assets/avatars/updated.webp",
      id: "user-1",
      name: "陈富东（新名称）",
      nickname: "",
    }
    act(() => {
      mocks.providerOptions?.onAwarenessChange?.({
        states: [{ clientId: 1, user: { color: "#112233", id: "user-2", name: "李四" } }],
      })
    })

    await waitFor(() =>
      expect(mocks.setAwarenessField).toHaveBeenLastCalledWith(
        "user",
        expect.objectContaining({
          avatar: "/assets/avatars/updated.webp",
          id: "user-1",
          name: "陈富东（新名称）",
        }),
      ),
    )
    expect(mocks.attachProvider).toHaveBeenCalledOnce()
    expect(mocks.destroyProvider).not.toHaveBeenCalled()
    expect(mocks.destroyWebsocketProvider).not.toHaveBeenCalled()
  })

  it("StrictMode 重放 Effect 时不销毁仍在使用的协作文档", async () => {
    const destroyDocument = vi.spyOn(Y.Doc.prototype, "destroy")
    renderPage(true)
    await screen.findByRole("textbox", { name: "文档页面标题" })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.providerOptions?.document).toBeDefined()
    expect(destroyDocument.mock.contexts).not.toContain(mocks.providerOptions?.document)
    expect(mocks.passedCollaborationProvider).toBeDefined()
  })

  it("StrictMode 重放 Effect 后仍会自动保存标题", async () => {
    mocks.updateCollaborativeDocumentTitle.mockResolvedValue("StrictMode 标题")
    renderPage(true)
    fireEvent.change(await screen.findByRole("textbox", { name: "顶部文档标题" }), {
      target: { value: "StrictMode 标题" },
    })

    await waitFor(
      () =>
        expect(mocks.updateCollaborativeDocumentTitle).toHaveBeenCalledWith(
          document.id,
          "StrictMode 标题",
        ),
      { timeout: 1_500 },
    )
    expect(await screen.findByText(/标题已自动保存.*正文已同步/)).toBeInTheDocument()
  })
})

function renderPage(strictMode = false) {
  const router = createMemoryRouter(
    [
      {
        path: "/documents/document/:documentId",
        element: <DocumentPage />,
      },
      { path: "/projects/:projectId/documents", element: <div>项目页面</div> },
      { path: "/projects/:projectId", element: <div>项目页面</div> },
    ],
    { initialEntries: [`/documents/document/${document.id}`] },
  )
  const page = (
    <DesktopTargetContext.Provider
      value={{ id: "server-1", normalizedUrl: "https://chat.example.com", userId: "user-1" }}
    >
      <RouterProvider router={router} />
    </DesktopTargetContext.Provider>
  )
  render(strictMode ? <StrictMode>{page}</StrictMode> : page)
  return router
}
