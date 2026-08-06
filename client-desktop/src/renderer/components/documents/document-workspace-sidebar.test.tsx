import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createClientDocument: vi.fn(),
  listClientDocuments: vi.fn(),
}))

vi.mock("@/lib/document-data-api", () => ({
  createClientDocument: mocks.createClientDocument,
  listClientDocuments: mocks.listClientDocuments,
}))

import { DesktopTargetContext } from "@/lib/desktop-target-context"
import { DocumentWorkspaceSidebar } from "./document-workspace-sidebar"

const activeDocument = documentFixture("550e8400-e29b-41d4-a716-446655440000", "当前文档")
const otherDocument = documentFixture("650e8400-e29b-41d4-a716-446655440000", "其他文档")

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState({}, "", "/")
})

describe("DocumentWorkspaceSidebar", () => {
  it("子窗口点击其他文档时打开或聚焦独立窗口，不改变当前路由", async () => {
    const user = userEvent.setup()
    const openDocumentWindow = vi.fn().mockResolvedValue({
      ok: true,
      result: { status: "created" },
    })
    vi.stubGlobal("desktop", { navigation: { openDocumentWindow } })
    mocks.listClientDocuments.mockResolvedValue([activeDocument, otherDocument])
    window.history.replaceState(
      {},
      "",
      `/documents/document/${activeDocument.id}?serverId=server-1&window=document`,
    )
    renderSidebar()

    await user.click(await screen.findByRole("treeitem", { name: "在新窗口打开：其他文档" }))

    await waitFor(() =>
      expect(openDocumentWindow).toHaveBeenCalledWith(otherDocument.id, "server-1"),
    )
    expect(window.location.pathname).toBe(`/documents/document/${activeDocument.id}`)
    expect(screen.getByRole("treeitem", { name: "当前文档" })).toBeDisabled()
  })

  it("子窗口新建文档后为新文档创建独立窗口", async () => {
    const user = userEvent.setup()
    const created = documentFixture("750e8400-e29b-41d4-a716-446655440000", "未命名文档")
    const openDocumentWindow = vi.fn().mockResolvedValue({
      ok: true,
      result: { status: "created" },
    })
    vi.stubGlobal("desktop", { navigation: { openDocumentWindow } })
    mocks.listClientDocuments.mockResolvedValue([activeDocument])
    mocks.createClientDocument.mockResolvedValue(created)
    window.history.replaceState(
      {},
      "",
      `/documents/document/${activeDocument.id}?serverId=server-1&window=document`,
    )
    renderSidebar()

    await user.click(await screen.findByRole("button", { name: "新建文档" }))

    await waitFor(() => expect(openDocumentWindow).toHaveBeenCalledWith(created.id, "server-1"))
    expect(window.location.pathname).toBe(`/documents/document/${activeDocument.id}`)
  })
})

function renderSidebar() {
  render(
    <DesktopTargetContext.Provider
      value={{ id: "server-1", normalizedUrl: "https://chat.example.com", userId: "user-1" }}
    >
      <MemoryRouter>
        <DocumentWorkspaceSidebar
          activeDocumentId={activeDocument.id}
          activeTitle={activeDocument.title}
          getEditVersion={() => 0}
          onAllowConfirmedNavigation={vi.fn()}
          onBeforeNavigate={() => true}
          projectId="project-1"
          projectName="项目"
        />
      </MemoryRouter>
    </DesktopTargetContext.Provider>,
  )
}

function documentFixture(id: string, title: string) {
  return {
    createdAt: "2026-08-04T09:00:00Z",
    creator: { avatar: "", id: "user-1", name: "用户", nickname: "" },
    documentType: "document" as const,
    id,
    kind: "document" as const,
    parentId: null,
    projectId: "project-1",
    schemaVersion: 1,
    sortOrder: 0,
    title,
    updatedAt: "2026-08-04T09:00:00Z",
    updatedBy: { avatar: "", id: "user-1", name: "用户", nickname: "" },
  }
}
