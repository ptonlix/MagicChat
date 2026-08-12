import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
import type { ProjectTask } from "@/components/projects/project-types"

const mocks = vi.hoisted(() => ({
  deleteClientProjectTask: vi.fn(),
  getClientProjectTask: vi.fn(),
  listClientProjectTaskActivities: vi.fn(),
  addClientProjectTaskComment: vi.fn(),
  listAllClientProjectMembers: vi.fn(),
  listClientProjectTasks: vi.fn(),
  sendConversationCard: vi.fn(),
  updateClientProjectTask: vi.fn(),
}))

vi.mock("@/lib/project-task-data-api", () => ({
  deleteClientProjectTask: mocks.deleteClientProjectTask,
  getClientProjectTask: mocks.getClientProjectTask,
  listClientProjectTaskActivities: mocks.listClientProjectTaskActivities,
  addClientProjectTaskComment: mocks.addClientProjectTaskComment,
  listClientProjectTasks: mocks.listClientProjectTasks,
  updateClientProjectTask: mocks.updateClientProjectTask,
}))

vi.mock("@/lib/project-members", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/project-members")>()
  return {
    ...original,
    listAllClientProjectMembers: mocks.listAllClientProjectMembers,
  }
})

vi.mock("@/lib/client-data-context", () => ({
  useOptionalClientData: () => null,
  useClientData: () => ({
    conversations: [
      {
        avatar: "",
        id: "conversation-1",
        name: "设计群",
        type: "group",
      },
    ],
    sendConversationCard: mocks.sendConversationCard,
  }),
}))

describe("ProjectTaskDetailsDialog card message", () => {
  beforeEach(() => {
    const task = createTask()
    mocks.deleteClientProjectTask.mockReset()
    mocks.deleteClientProjectTask.mockResolvedValue(task.id)
    mocks.getClientProjectTask.mockReset()
    mocks.getClientProjectTask.mockResolvedValue(task)
    mocks.listClientProjectTaskActivities.mockReset()
    mocks.listClientProjectTaskActivities.mockResolvedValue({ activities: [], nextCursor: null })
    mocks.addClientProjectTaskComment.mockReset()
    mocks.listAllClientProjectMembers.mockReset()
    mocks.listAllClientProjectMembers.mockResolvedValue([])
    mocks.listClientProjectTasks.mockReset()
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [],
    })
    mocks.sendConversationCard.mockReset()
    mocks.sendConversationCard.mockResolvedValue({
      id: "message-1",
    })
    mocks.updateClientProjectTask.mockReset()
    mocks.updateClientProjectTask.mockResolvedValue(task)
  })

  it("renders the task workspace details inline without an overlay", async () => {
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog embedded onOpenChange={vi.fn()} open task={createTask()} />
      </MemoryRouter>,
    )

    expect(await screen.findByRole("dialog", { name: "任务标题" })).toBeInTheDocument()
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
    expect(screen.getByRole("button", { name: "返回任务列表" })).toBeInTheDocument()
  })

  it("saves a changed title on blur", async () => {
    const user = userEvent.setup()
    mocks.updateClientProjectTask.mockResolvedValue({
      ...createTask(),
      title: "新的任务标题",
      updatedAt: "2026-07-14T09:00:00Z",
    })
    const onUpdated = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          embedded
          onOpenChange={vi.fn()}
          onUpdated={onUpdated}
          open
          task={createTask()}
        />
      </MemoryRouter>,
    )

    const title = await screen.findByRole("button", { name: "任务标题" })
    await waitFor(() => expect(title).toBeEnabled())
    await user.click(title)
    const input = screen.getByRole("textbox", { name: "标题" })
    await user.clear(input)
    await user.type(input, "新的任务标题")
    await user.tab()

    await waitFor(() => {
      expect(mocks.updateClientProjectTask).toHaveBeenCalledWith("project-1", "task-1", {
        title: "新的任务标题",
      })
      expect(onUpdated).toHaveBeenCalledOnce()
    })
    expect(await screen.findByRole("button", { name: "新的任务标题" })).toBeInTheDocument()
  })

  it("disables other task edits while saving the title", async () => {
    const user = userEvent.setup()
    const titleSave = deferred<ProjectTask>()
    mocks.updateClientProjectTask.mockReturnValueOnce(titleSave.promise)
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog embedded onOpenChange={vi.fn()} open task={createTask()} />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole("button", { name: "任务标题" }))
    const title = screen.getByRole("textbox", { name: "标题" })
    await user.clear(title)
    await user.type(title, "保存中的标题")
    await user.tab()

    await waitFor(() =>
      expect(mocks.updateClientProjectTask).toHaveBeenCalledWith("project-1", "task-1", {
        title: "保存中的标题",
      }),
    )
    expect(screen.getByRole("combobox", { name: "状态" })).toBeDisabled()

    titleSave.resolve({ ...createTask(), title: "保存中的标题" })
    await waitFor(() => expect(screen.getByRole("combobox", { name: "状态" })).toBeEnabled())
  })

  it("sends the task card and keeps the task details open", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog onOpenChange={onOpenChange} open task={createTask()} />
      </MemoryRouter>,
    )

    const moreButton = await screen.findByRole("button", { name: "更多任务操作" })
    await waitFor(() => expect(moreButton).toBeEnabled())
    await user.click(moreButton)
    await user.click(screen.getByRole("menuitem", { name: "发送到对话" }))

    await user.click(await screen.findByRole("radio", { name: "设计群" }))
    await user.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => {
      expect(mocks.sendConversationCard).toHaveBeenCalledWith("conversation-1", {
        entityId: "task-1",
        entityType: "task",
        type: "entity_card",
      })
    })
    expect(screen.queryByRole("dialog", { name: "发送到对话" })).not.toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: "任务标题" })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("confirms before deleting the task", async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onDeleted={onDeleted}
          onOpenChange={onOpenChange}
          open
          task={createTask()}
        />
      </MemoryRouter>,
    )

    const moreButton = await screen.findByRole("button", { name: "更多任务操作" })
    await waitFor(() => expect(moreButton).toBeEnabled())
    await user.click(moreButton)
    await user.click(screen.getByRole("menuitem", { name: "删除任务" }))
    const confirmation = screen.getByRole("alertdialog", { name: "删除任务" })
    expect(mocks.deleteClientProjectTask).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole("button", { name: "删除任务" }))
    await waitFor(() => {
      expect(mocks.deleteClientProjectTask).toHaveBeenCalledWith("project-1", "task-1")
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onDeleted).toHaveBeenCalledWith("task-1")
    })
    expect(mocks.updateClientProjectTask).not.toHaveBeenCalled()
  })

  it("keeps task details and unsaved edits after deletion fails", async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const onOpenChange = vi.fn()
    mocks.deleteClientProjectTask.mockRejectedValue(new Error("没有删除权限"))
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onDeleted={onDeleted}
          onOpenChange={onOpenChange}
          open
          task={createTask()}
        />
      </MemoryRouter>,
    )

    const moreButton = await screen.findByRole("button", { name: "更多任务操作" })
    await waitFor(() => expect(moreButton).toBeEnabled())
    await user.click(moreButton)
    await user.click(screen.getByRole("menuitem", { name: "删除任务" }))
    const confirmation = screen.getByRole("alertdialog", { name: "删除任务" })
    await user.click(within(confirmation).getByRole("button", { name: "删除任务" }))

    await waitFor(() => expect(mocks.deleteClientProjectTask).toHaveBeenCalledOnce())
    expect(screen.getByText("任务标题").closest('[role="dialog"]')).toBeInTheDocument()
    expect(confirmation).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mocks.updateClientProjectTask).not.toHaveBeenCalled()
  })

  it("configures a recurring reminder in the task form", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onUpdated = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onOpenChange={onOpenChange}
          onUpdated={onUpdated}
          open
          task={createTask()}
        />
      </MemoryRouter>,
    )

    const reminderButton = await screen.findByRole("button", {
      name: "提醒时间",
    })
    expect(reminderButton).toHaveTextContent("不提醒")
    await user.click(reminderButton)
    await user.click(screen.getByRole("button", { name: "重复" }))
    expect(mocks.updateClientProjectTask).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "确定" }))

    await waitFor(() => {
      expect(mocks.updateClientProjectTask).toHaveBeenCalledWith("project-1", "task-1", {
        reminder: expect.objectContaining({
          frequency: "daily",
          mode: "recurring",
          timezone: "Asia/Shanghai",
        }),
      })
      expect(onUpdated).toHaveBeenCalledOnce()
      expect(onOpenChange).not.toHaveBeenCalled()
    })
  })
})

function createTask(): ProjectTask {
  return {
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-07-14T08:00:00Z",
    creator: {
      avatar: "",
      id: "user-1",
      name: "Alice",
      nickname: "",
    },
    description: "**这是任务说明**",
    dueDate: "2026-07-20",
    id: "task-1",
    labels: [],
    priority: 2,
    reminder: null,
    projectId: "project-1",
    startDate: "2026-07-14",
    status: "todo",
    title: "任务标题",
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
