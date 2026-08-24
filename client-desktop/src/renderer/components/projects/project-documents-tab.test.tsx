import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: unknown) => void) | undefined,
  sensorTypes: [] as unknown[],
}))

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>()
  const React = await import("react")
  return {
    ...actual,
    DndContext(props: React.ComponentProps<typeof actual.DndContext>) {
      mocks.onDragEnd = props.onDragEnd as (event: unknown) => void
      return React.createElement(actual.DndContext, props)
    },
    useSensor(sensor: unknown, options?: unknown) {
      mocks.sensorTypes.push(sensor)
      return actual.useSensor(sensor as never, options as never)
    },
  }
})

import { KeyboardSensor } from "@dnd-kit/core"
import { DesktopTargetContext } from "@/lib/desktop-target-context"

import { ProjectDocumentsTab } from "./project-documents-tab"

const base = {
  created_at: "2026-08-04T09:00:00Z",
  creator: { id: "user-1", name: "用户" },
  document_type: "document",
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "document",
  parent_id: null,
  project_id: "project-1",
  schema_version: 1,
  sort_order: 0,
  title: "产品需求文档",
  updated_at: "2026-08-04T09:00:00Z",
  updated_by: { id: "user-1", name: "用户" },
}
const second = {
  ...base,
  id: "650e8400-e29b-41d4-a716-446655440000",
  sort_order: 1,
  title: "技术设计文档",
}

afterEach(() => {
  mocks.onDragEnd = undefined
  vi.unstubAllGlobals()
})

describe("ProjectDocumentsTab", () => {
  it("注册键盘拖拽传感器", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([])))
    renderTab()
    expect(mocks.sensorTypes).toContain(KeyboardSensor)
  })

  it("加载真实文档并只过滤当前树", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([base])))
    renderTab()
    expect(await screen.findByRole("link", { name: /产品需求文档/ })).toHaveAttribute(
      "href",
      "/documents/document/550e8400-e29b-41d4-a716-446655440000",
    )
    await user.type(screen.getByRole("searchbox", { name: "搜索当前项目文档" }), "不存在")
    expect(screen.getByText("没有匹配的文档")).toBeVisible()
  })

  it("文档操作菜单通过窄 Bridge 打开新窗口，不改变普通链接导航", async () => {
    const user = userEvent.setup()
    const openDocumentWindow = vi.fn().mockResolvedValue({
      ok: true,
      result: { status: "created" },
    })
    vi.stubGlobal("desktop", { navigation: { openDocumentWindow } })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([base])))
    render(
      <DesktopTargetContext.Provider
        value={{ id: "server-1", normalizedUrl: "https://chat.example.com", userId: "user-1" }}
      >
        <MemoryRouter>
          <ProjectDocumentsTab projectId="project-1" />
        </MemoryRouter>
      </DesktopTargetContext.Provider>,
    )

    await screen.findByRole("link", { name: /产品需求文档/ })
    await user.click(screen.getByRole("button", { name: /操作.*产品需求文档/ }))
    expect(
      screen.getByRole("menuitem", { name: "新窗口打开" }).querySelector("svg.lucide-app-window"),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("menuitem", { name: "新窗口打开" }))

    await waitFor(() =>
      expect(openDocumentWindow).toHaveBeenCalledWith(base.id, "server-1", "document"),
    )
    expect(screen.getByRole("link", { name: /产品需求文档/ })).toHaveAttribute(
      "href",
      `/documents/document/${base.id}`,
    )
  })

  it("区分空状态和加载错误并允许重试", async () => {
    const user = userEvent.setup()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("failure", { status: 500 }))
      .mockResolvedValueOnce(response([]))
    vi.stubGlobal("fetch", fetcher)
    renderTab()
    expect(await screen.findByText("加载文档列表失败")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByText("还没有文档")).toBeVisible()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })

  it("拖动提交成功后重新加载权威列表校准位置", async () => {
    const moved = { ...base, sort_order: 1 }
    const authoritative = [{ ...second, sort_order: 0 }, moved]
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([base, second]))
      .mockResolvedValueOnce(dataResponse(moved))
      .mockResolvedValueOnce(response(authoritative))
    vi.stubGlobal("fetch", fetcher)
    renderTab()
    await screen.findByRole("link", { name: /产品需求文档/ })

    act(() => {
      mocks.onDragEnd?.({
        active: { id: base.id },
        over: { data: { current: { index: 2, kind: "position", parentId: null } } },
      })
    })

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(fetcher.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual([
      "GET",
      "POST",
      "GET",
    ])
  })
})

function renderTab() {
  render(
    <MemoryRouter>
      <ProjectDocumentsTab projectId="project-1" />
    </MemoryRouter>,
  )
}

function response(documents: unknown[]) {
  return dataResponse({ documents })
}

function dataResponse(data: unknown) {
  return new Response(JSON.stringify({ data, success: true }), {
    headers: { "content-type": "application/json" },
  })
}
