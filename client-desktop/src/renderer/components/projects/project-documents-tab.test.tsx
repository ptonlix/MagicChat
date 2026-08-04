import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ sensorTypes: [] as unknown[] }))

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>()
  return {
    ...actual,
    useSensor(sensor: unknown, options?: unknown) {
      mocks.sensorTypes.push(sensor)
      return actual.useSensor(sensor as never, options as never)
    },
  }
})

import { KeyboardSensor } from "@dnd-kit/core"

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

afterEach(() => vi.unstubAllGlobals())

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
})

function renderTab() {
  render(
    <MemoryRouter>
      <ProjectDocumentsTab projectId="project-1" />
    </MemoryRouter>,
  )
}

function response(documents: unknown[]) {
  return new Response(JSON.stringify({ data: { documents }, success: true }), {
    headers: { "content-type": "application/json" },
  })
}
