import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectTasksTab } from "@/components/projects/project-tasks-tab"
import type { ProjectTask } from "@/components/projects/project-types"

const projectTaskApiMocks = vi.hoisted(() => ({
  listClientProjectTasks: vi.fn(),
}))

vi.mock("@/lib/project-task-data-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/project-task-data-api")>()
  return {
    ...original,
    listClientProjectTasks: projectTaskApiMocks.listClientProjectTasks,
  }
})

vi.mock("@/lib/project-members", () => ({
  listAllClientProjectMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/components/projects/project-task-details-dialog", () => ({
  ProjectTaskDetailsDialog: ({
    onOpenChange,
    task,
  }: {
    onOpenChange: (open: boolean) => void
    task: ProjectTask
  }) => (
    <div aria-label="任务详情" role="dialog">
      <span>{task.title}</span>
      <button onClick={() => onOpenChange(false)} type="button">
        关闭详情
      </button>
    </div>
  ),
}))

describe("ProjectTasksTab task navigation", () => {
  beforeEach(() => {
    window.localStorage.clear()
    projectTaskApiMocks.listClientProjectTasks.mockReset()
  })

  it("opens the standalone task workspace when a task is opened", async () => {
    const user = userEvent.setup()
    const task = createProjectTask()
    projectTaskApiMocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [task],
    })

    renderProjectTasksTab("/projects/project-1?source=list")

    await user.click(
      await screen.findByRole("button", {
        name: `查看任务详情：${task.title}`,
      }),
    )

    expect(screen.getByTestId("location-path")).toHaveTextContent("/tasks/project-1/task-1")
  })
})

function renderProjectTasksTab(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/projects/:projectId"
          element={
            <>
              <ProjectTasksTab
                onTasksChanged={vi.fn().mockResolvedValue(undefined)}
                projectId="project-1"
              />
            </>
          }
        />
        <Route path="/tasks/:projectId/:taskId" element={<LocationPath />} />
      </Routes>
    </MemoryRouter>,
  )
}

function LocationPath() {
  const location = useLocation()
  return <output data-testid="location-path">{location.pathname}</output>
}

function createProjectTask(): ProjectTask {
  const creator = {
    avatar: "",
    id: "user-1",
    name: "Creator",
    nickname: "创建人",
  }
  return {
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-07-14T01:00:00Z",
    creator,
    description: "任务描述",
    dueDate: "2026-07-20",
    id: "task-1",
    labels: [],
    priority: 2,
    reminder: null,
    projectId: "project-1",
    startDate: "2026-07-14",
    status: "todo",
    title: "路由任务",
    updatedAt: "2026-07-14T01:00:00Z",
  }
}
