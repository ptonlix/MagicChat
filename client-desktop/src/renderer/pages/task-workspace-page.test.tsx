import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TaskWorkspacePage } from "@/pages/task-workspace-page"
import type { ProjectTask } from "@/components/projects/project-types"

const mocks = vi.hoisted(() => ({
  getClientProject: vi.fn(),
  getClientProjectTask: vi.fn(),
  listClientProjects: vi.fn(),
  listClientProjectTasks: vi.fn(),
}))

vi.mock("@/lib/project-data-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/project-data-api")>()
  return {
    ...original,
    getClientProject: mocks.getClientProject,
    listClientProjects: mocks.listClientProjects,
  }
})

vi.mock("@/lib/project-task-data-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/project-task-data-api")>()
  return {
    ...original,
    getClientProjectTask: mocks.getClientProjectTask,
    listClientProjectTasks: mocks.listClientProjectTasks,
  }
})

vi.mock("@/components/projects/create-project-task-dialog", () => ({
  CreateProjectTaskDialog: () => null,
}))

vi.mock("@/components/projects/project-task-details-dialog", () => ({
  ProjectTaskDetailsDialog: () => null,
}))

describe("TaskWorkspacePage", () => {
  beforeEach(() => {
    mocks.getClientProject.mockReset().mockRejectedValue(new Error("not needed"))
    mocks.getClientProjectTask.mockReset()
    mocks.listClientProjects.mockReset().mockResolvedValue({
      nextCursor: null,
      personalProject: null,
      projects: [],
    })
    mocks.listClientProjectTasks.mockReset()
  })

  it("does not append a stale pagination response after the search query changes", async () => {
    const user = userEvent.setup()
    const loadMore = deferred<TaskPage>()
    const search = deferred<TaskPage>()
    mocks.listClientProjectTasks.mockImplementation(
      (_projectId: string, options: { cursor?: string; keyword?: string }) => {
        if (options.cursor) return loadMore.promise
        if (options.keyword === "新搜索") return search.promise
        return Promise.resolve({
          nextCursor: "cursor-old",
          tasks: [createTask("old-first", "旧结果")],
        })
      },
    )

    renderTaskWorkspace()

    expect(await screen.findByText("旧结果")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "加载更多" }))
    await user.type(screen.getByRole("textbox", { name: "搜索任务内容" }), "新搜索")

    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ keyword: "新搜索" }),
      ),
    )
    search.resolve({ nextCursor: null, tasks: [createTask("new-result", "新结果")] })
    expect(await screen.findByText("新结果")).toBeInTheDocument()

    loadMore.resolve({ nextCursor: null, tasks: [createTask("old-more", "旧分页结果")] })
    await waitFor(() => expect(screen.queryByText("旧分页结果")).not.toBeInTheDocument())
  })

  it("returns to chat from the task workspace", async () => {
    const user = userEvent.setup()
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [createTask("task-1", "任务一")],
    })

    renderTaskWorkspace()

    expect(await screen.findByText("任务一")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "返回聊天" }))

    expect(screen.getByTestId("current-path")).toHaveTextContent("/chat")
  })
})

type TaskPage = {
  nextCursor: string | null
  tasks: ProjectTask[]
}

function renderTaskWorkspace() {
  return render(
    <MemoryRouter initialEntries={["/tasks/project-1"]}>
      <Routes>
        <Route element={<TaskWorkspacePage />} path="/tasks/:projectId/:taskId?" />
        <Route element={<CurrentPath />} path="/chat" />
      </Routes>
    </MemoryRouter>,
  )
}

function CurrentPath() {
  const { pathname } = useLocation()
  return <output data-testid="current-path">{pathname}</output>
}

function createTask(id: string, title: string): ProjectTask {
  return {
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-07-14T08:00:00Z",
    creator: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
    description: "",
    dueDate: null,
    id,
    labels: [],
    priority: 2,
    reminder: null,
    projectId: "project-1",
    startDate: null,
    status: "todo",
    title,
    updatedAt: "2026-07-14T08:00:00Z",
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
