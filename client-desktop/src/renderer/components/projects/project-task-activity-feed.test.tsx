import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectTaskActivityFeed } from "@/components/projects/project-task-activity-feed"
import type { ProjectTaskActivity } from "@/components/projects/project-types"

const mocks = vi.hoisted(() => ({
  addClientProjectTaskComment: vi.fn(),
  listClientProjectTaskActivities: vi.fn(),
}))

vi.mock("@/lib/project-task-data-api", () => ({
  addClientProjectTaskComment: mocks.addClientProjectTaskComment,
  listClientProjectTaskActivities: mocks.listClientProjectTaskActivities,
}))

describe("ProjectTaskActivityFeed", () => {
  beforeEach(() => {
    mocks.addClientProjectTaskComment.mockReset()
    mocks.listClientProjectTaskActivities.mockReset()
  })

  it("keeps a submitted comment when a subsequent activity refresh finishes", async () => {
    const user = userEvent.setup()
    const initial = deferred<ActivityPage>()
    const refresh = deferred<ActivityPage>()
    mocks.listClientProjectTaskActivities
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refresh.promise)
    mocks.addClientProjectTaskComment.mockResolvedValue(createComment("activity-comment", "新评论"))

    const { rerender } = render(
      <MemoryRouter>
        <ProjectTaskActivityFeed
          projectId="project-1"
          revision="2026-07-14T08:00:00Z"
          taskId="task-1"
        />
      </MemoryRouter>,
    )

    const input = screen.getByRole("textbox", { name: "发表评论" })
    expect(input).toBeDisabled()

    initial.resolve({ activities: [], nextCursor: null })
    await waitFor(() => expect(input).toBeEnabled())

    await user.type(input, "新评论")
    await user.click(screen.getByRole("button", { name: "评论" }))
    expect(await screen.findByText("新评论")).toBeInTheDocument()

    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute(
      "href",
      "/contacts/user/user-1",
    )
    expect(screen.getByRole("link", { name: "Alice" })).not.toHaveAttribute("target")

    rerender(
      <MemoryRouter>
        <ProjectTaskActivityFeed
          projectId="project-1"
          revision="2026-07-14T09:00:00Z"
          taskId="task-1"
        />
      </MemoryRouter>,
    )
    await waitFor(() => expect(mocks.listClientProjectTaskActivities).toHaveBeenCalledTimes(2))
    refresh.resolve({ activities: [], nextCursor: null })

    expect(await screen.findByText("新评论")).toBeInTheDocument()
  })
})

type ActivityPage = {
  activities: ProjectTaskActivity[]
  nextCursor: string | null
}

function createComment(id: string, content: string): ProjectTaskActivity {
  return {
    actor: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
    changes: [],
    content,
    createdAt: "2026-07-14T08:00:00Z",
    id,
    projectId: "project-1",
    taskId: "task-1",
    type: "commented",
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
