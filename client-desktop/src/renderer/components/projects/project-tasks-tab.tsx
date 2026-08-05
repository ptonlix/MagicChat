import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import {
  CalendarDays,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleCheckBig,
  CircleDot,
  CircleX,
  ChartGantt,
  Columns3,
  Equal,
  ListTodo,
  Plus,
  Search,
} from "lucide-react"

import { CreateProjectTaskDialog } from "@/components/projects/create-project-task-dialog"
import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
import { ProjectTaskBoardView } from "@/components/projects/project-task-board-view"
import { ProjectTaskCalendarView } from "@/components/projects/project-task-calendar-view"
import { ProjectTaskGanttView } from "@/components/projects/project-task-gantt-view"
import { ProjectTaskListView } from "@/components/projects/project-task-list-view"
import { ProjectMemberAvatar } from "@/components/projects/project-member-avatar"
import type {
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "@/components/projects/project-types"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ClientProjectMember } from "@/lib/project-data-api"
import { listAllClientProjectMembers } from "@/lib/project-members"
import { getClientProjectTask, listClientProjectTasks } from "@/lib/project-task-data-api"
import { cn } from "@/lib/utils"

function getTaskViews(t: ReturnType<typeof useLocale>["t"]) {
  return [
    { value: "list", label: t("project.view.list"), icon: ListTodo },
    { value: "board", label: t("project.view.board"), icon: Columns3 },
    { value: "calendar", label: t("project.view.calendar"), icon: CalendarDays },
    { value: "gantt", label: t("project.view.gantt"), icon: ChartGantt },
  ] as const
}

type TaskView = ReturnType<typeof getTaskViews>[number]["value"]

const projectTaskViewStorageKey = "project-task-view"
const projectTaskIdSearchParam = "taskId"

type TaskFilters = {
  assigneeUserIds: string[]
  keyword: string
  priorities: ProjectTaskPriority[]
  statuses: ProjectTaskStatus[]
}

function getStatusOptions(t: ReturnType<typeof useLocale>["t"]): Array<{
  label: string
  value: ProjectTaskStatus
}> {
  return [
    { label: t("project.filter.todo"), value: "todo" },
    { label: t("project.filter.in_progress"), value: "in_progress" },
    { label: t("project.filter.done"), value: "done" },
    { label: t("project.filter.canceled"), value: "canceled" },
  ]
}

const defaultTaskStatuses: ProjectTaskStatus[] = ["todo", "in_progress"]

function getPriorityOptions(t: ReturnType<typeof useLocale>["t"]): Array<{
  label: string
  value: ProjectTaskPriority
}> {
  return [
    { label: t("project.priority.low"), value: 1 },
    { label: t("project.priority.medium"), value: 2 },
    { label: t("project.priority.high"), value: 3 },
  ]
}

function createDefaultTaskFilters(): TaskFilters {
  return {
    assigneeUserIds: [],
    keyword: "",
    priorities: [],
    statuses: [...defaultTaskStatuses],
  }
}

function readStoredProjectTaskView(): TaskView {
  if (typeof window === "undefined") {
    return "list"
  }

  try {
    const value = window.localStorage.getItem(projectTaskViewStorageKey)
    return getTaskViews((_key) => _key).some((view) => view.value === value)
      ? (value as TaskView)
      : "list"
  } catch {
    return "list"
  }
}

function storeProjectTaskView(view: TaskView) {
  try {
    window.localStorage.setItem(projectTaskViewStorageKey, view)
  } catch {
    // View switching should still work when local storage is unavailable.
  }
}

export function ProjectTasksTab({
  onTasksChanged,
  projectId,
}: {
  onTasksChanged: () => Promise<void>
  projectId: string
}) {
  const { t } = useLocale()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeView, setActiveView] = React.useState<TaskView>(readStoredProjectTaskView)
  const [fallbackActiveTask, setFallbackActiveTask] = React.useState<ProjectTask | null>(null)
  const [appliedFilters, setAppliedFilters] = React.useState<TaskFilters>(createDefaultTaskFilters)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [filters, setFilters] = React.useState<TaskFilters>(createDefaultTaskFilters)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [members, setMembers] = React.useState<ClientProjectMember[]>([])
  const [membersError, setMembersError] = React.useState(false)
  const [membersLoading, setMembersLoading] = React.useState(true)
  const [tasks, setTasks] = React.useState<ProjectTask[]>([])
  const activeTaskId = searchParams.get(projectTaskIdSearchParam)?.trim() ?? ""
  const activeTask =
    tasks.find((task) => task.id === activeTaskId) ??
    (fallbackActiveTask?.id === activeTaskId && fallbackActiveTask.projectId === projectId
      ? fallbackActiveTask
      : null)

  React.useEffect(() => {
    let active = true
    void listAllProjectTasks(projectId, appliedFilters)
      .then((nextTasks) => {
        if (active) {
          setTasks(nextTasks)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : t("project.loadTasksFailed"))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [appliedFilters, projectId, t])

  React.useEffect(() => {
    let active = true

    void listAllClientProjectMembers(projectId)
      .then((nextMembers) => {
        if (active) {
          setMembers(nextMembers.filter((member) => member.status === "active"))
        }
      })
      .catch(() => {
        if (active) {
          setMembersError(true)
        }
      })
      .finally(() => {
        if (active) {
          setMembersLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [projectId])

  React.useEffect(() => {
    if (!activeTaskId) {
      return
    }

    const listedTask = tasks.find((task) => task.id === activeTaskId)
    if (
      listedTask ||
      loading ||
      (fallbackActiveTask?.id === activeTaskId && fallbackActiveTask.projectId === projectId)
    ) {
      return
    }

    let active = true
    void getClientProjectTask(projectId, activeTaskId)
      .then((task) => {
        if (active) {
          setFallbackActiveTask(task)
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return
        }
        setFallbackActiveTask(null)
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current)
            next.delete(projectTaskIdSearchParam)
            return next
          },
          { replace: true },
        )
        toast.error(loadError instanceof Error ? loadError.message : t("project.loadTaskFailed"))
      })

    return () => {
      active = false
    }
  }, [activeTaskId, fallbackActiveTask, loading, projectId, setSearchParams, tasks, t])

  async function refreshTasks() {
    try {
      setTasks(await listAllProjectTasks(projectId, appliedFilters))
      setError("")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("project.refreshTasksFailed"))
    }
  }

  async function handleTaskCreated() {
    await Promise.allSettled([refreshTasks(), onTasksChanged()])
  }

  async function handleTaskUpdated() {
    await Promise.allSettled([refreshTasks(), onTasksChanged()])
  }

  function handleTaskDeleted(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId))
    setFallbackActiveTask(null)
    void onTasksChanged().catch(() => undefined)
  }

  function handleTaskStatusChange(taskId: string, status: ProjectTaskStatus) {
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, status } : task)))
  }

  function handleViewChange(view: TaskView) {
    setActiveView(view)
    storeProjectTaskView(view)
  }

  function handleOpenTask(task: ProjectTask) {
    setFallbackActiveTask(task)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set(projectTaskIdSearchParam, task.id)
      return next
    })
  }

  function handleCloseTask() {
    setFallbackActiveTask(null)
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete(projectTaskIdSearchParam)
        return next
      },
      { replace: true },
    )
  }

  function applyFilters(nextFilters: TaskFilters) {
    const normalizedFilters = {
      ...nextFilters,
      keyword: nextFilters.keyword.trim(),
    }
    setError("")
    setLoading(true)
    setAppliedFilters(normalizedFilters)
  }

  function handleFilterSelectionChange(nextFilters: TaskFilters) {
    setFilters(nextFilters)
    applyFilters(nextFilters)
  }

  function handleSearch() {
    const normalizedFilters = {
      ...filters,
      keyword: filters.keyword.trim(),
    }
    setFilters(normalizedFilters)
    applyFilters(normalizedFilters)
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/10">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4">
          <TaskToolbar
            activeView={activeView}
            filters={filters}
            members={members}
            membersError={membersError}
            membersLoading={membersLoading}
            onCreateTask={() => setCreateDialogOpen(true)}
            onFilterSelectionChange={handleFilterSelectionChange}
            onFiltersChange={setFilters}
            onSearch={handleSearch}
            onViewChange={handleViewChange}
          />
          {loading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {t("project.loadingTasks")}
            </div>
          ) : error ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-destructive">
              <span>{error}</span>
              <Button onClick={() => void refreshTasks()} variant="outline">
                {t("project.reload")}
              </Button>
            </div>
          ) : activeView === "board" || activeView === "gantt" ? (
            <TaskViewContent
              activeView={activeView}
              emptyMessage={
                hasTaskFilters(appliedFilters) ? t("project.noTaskMatch") : t("project.noTasks")
              }
              onOpenTask={handleOpenTask}
              onTaskStatusChange={handleTaskStatusChange}
              onTaskUpdated={handleTaskUpdated}
              tasks={tasks}
            />
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <TaskViewContent
                activeView={activeView}
                emptyMessage={
                  hasTaskFilters(appliedFilters) ? t("project.noTaskMatch") : t("project.noTasks")
                }
                onOpenTask={handleOpenTask}
                onTaskStatusChange={handleTaskStatusChange}
                onTaskUpdated={handleTaskUpdated}
                tasks={tasks}
              />
            </ScrollArea>
          )}
        </div>
      </div>
      {activeTask && activeTask.id === activeTaskId && (
        <ProjectTaskDetailsDialog
          key={`${activeTask.id}-${activeTask.updatedAt}`}
          onDeleted={handleTaskDeleted}
          onOpenChange={(open) => {
            if (!open) {
              handleCloseTask()
            }
          }}
          onUpdated={handleTaskUpdated}
          open
          task={activeTask}
        />
      )}
      <CreateProjectTaskDialog
        onCreated={handleTaskCreated}
        onOpenChange={setCreateDialogOpen}
        open={createDialogOpen}
        projectId={projectId}
      />
    </>
  )
}

function TaskToolbar({
  activeView,
  filters,
  members,
  membersError,
  membersLoading,
  onCreateTask,
  onFilterSelectionChange,
  onFiltersChange,
  onSearch,
  onViewChange,
}: {
  activeView: TaskView
  filters: TaskFilters
  members: ClientProjectMember[]
  membersError: boolean
  membersLoading: boolean
  onCreateTask: () => void
  onFilterSelectionChange: (filters: TaskFilters) => void
  onFiltersChange: (filters: TaskFilters) => void
  onSearch: () => void
  onViewChange: (view: TaskView) => void
}) {
  const { t } = useLocale()
  const selectedAssignees = members.filter((member) => filters.assigneeUserIds.includes(member.id))

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <form
        className="flex min-w-0 flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch()
        }}
      >
        <StatusFilter
          onValueChange={(statuses) => onFilterSelectionChange({ ...filters, statuses })}
          value={filters.statuses}
        />
        <PriorityFilter
          onValueChange={(priorities) => onFilterSelectionChange({ ...filters, priorities })}
          value={filters.priorities}
        />
        <AssigneeFilter
          loading={membersLoading}
          members={members}
          membersError={membersError}
          onValueChange={(assigneeUserIds) =>
            onFilterSelectionChange({ ...filters, assigneeUserIds })
          }
          selectedAssignees={selectedAssignees}
          value={filters.assigneeUserIds}
        />
        <div className="relative min-w-52 sm:min-w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("project.searchTasks")}
            className="pl-8"
            onChange={(event) => onFiltersChange({ ...filters, keyword: event.target.value })}
            placeholder={t("project.searchTasks")}
            type="search"
            value={filters.keyword}
          />
        </div>
      </form>
      <div className="flex shrink-0 items-center gap-2">
        <TaskViewSwitcher value={activeView} onValueChange={onViewChange} />
        <Button onClick={onCreateTask} type="button">
          <Plus />
          {t("project.createTask")}
        </Button>
      </div>
    </div>
  )
}

async function listAllProjectTasks(projectId: string, filters: TaskFilters) {
  const tasks: ProjectTask[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await listClientProjectTasks(projectId, {
      assigneeUserIds: filters.assigneeUserIds,
      cursor,
      keyword: filters.keyword || undefined,
      limit: 100,
      priorities: filters.priorities,
      statuses: filters.statuses,
    })
    tasks.push(...page.tasks)
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      break
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)

  return tasks
}

function StatusFilter({
  onValueChange,
  value,
}: {
  onValueChange: (value: ProjectTaskStatus[]) => void
  value: ProjectTaskStatus[]
}) {
  const { t } = useLocale()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterButton
          active={value.length > 0}
          label={getFilterLabel(t("project.status"), value, getStatusOptions(t), t)}
          prefix={value.length > 0 ? t("project.status") : undefined}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {getStatusOptions(t).map((option) => (
          <DropdownMenuCheckboxItem
            checked={value.includes(option.value)}
            key={option.value}
            onCheckedChange={(checked) =>
              onValueChange(updateFilterSelection(value, option.value, checked === true))
            }
            onSelect={(event) => event.preventDefault()}
          >
            <TaskStatusIcon status={option.value} />
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PriorityFilter({
  onValueChange,
  value,
}: {
  onValueChange: (value: ProjectTaskPriority[]) => void
  value: ProjectTaskPriority[]
}) {
  const { t } = useLocale()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterButton
          active={value.length > 0}
          label={getFilterLabel(t("project.priority"), value, getPriorityOptions(t), t)}
          prefix={value.length > 0 ? t("project.priority") : undefined}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {getPriorityOptions(t).map((option) => (
          <DropdownMenuCheckboxItem
            checked={value.includes(option.value)}
            key={option.value}
            onCheckedChange={(checked) =>
              onValueChange(updateFilterSelection(value, option.value, checked === true))
            }
            onSelect={(event) => event.preventDefault()}
          >
            <TaskPriorityIcon priority={option.value} />
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AssigneeFilter({
  loading,
  members,
  membersError,
  onValueChange,
  selectedAssignees,
  value,
}: {
  loading: boolean
  members: ClientProjectMember[]
  membersError: boolean
  onValueChange: (value: string[]) => void
  selectedAssignees: ClientProjectMember[]
  value: string[]
}) {
  const { t } = useLocale()
  const [query, setQuery] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredMembers = normalizedQuery
    ? members.filter((member) =>
        [member.displayName, member.name, member.nickname, member.email].some((field) =>
          field.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : members

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          requestAnimationFrame(() => searchInputRef.current?.focus())
        } else {
          setQuery("")
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <FilterButton
          active={value.length > 0}
          className="max-w-40"
          label={
            selectedAssignees.length === 1
              ? selectedAssignees[0].displayName
              : selectedAssignees.length > 1
                ? t("project.assigneeCount", { count: selectedAssignees.length })
                : t("project.assignee")
          }
          prefix={value.length > 0 ? t("project.assignee") : undefined}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("project.searchAssignee")}
            className="h-8 pl-8"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") {
                event.stopPropagation()
              }
            }}
            placeholder={t("project.searchAssignee")}
            ref={searchInputRef}
            value={query}
          />
        </div>
        {filteredMembers.map((member) => (
          <DropdownMenuCheckboxItem
            checked={value.includes(member.id)}
            key={member.id}
            onCheckedChange={(checked) =>
              onValueChange(updateFilterSelection(value, member.id, checked === true))
            }
            onSelect={(event) => event.preventDefault()}
          >
            <ProjectMemberAvatar
              className="size-5"
              fallbackClassName="text-[10px]"
              member={member}
            />
            <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {loading && <DropdownMenuItem disabled>{t("project.loadingMembers")}</DropdownMenuItem>}
        {!loading && membersError && (
          <DropdownMenuItem disabled>{t("project.membersLoadFailed")}</DropdownMenuItem>
        )}
        {!loading && !membersError && members.length === 0 && (
          <DropdownMenuItem disabled>{t("project.noMembers")}</DropdownMenuItem>
        )}
        {!loading && !membersError && members.length > 0 && filteredMembers.length === 0 && (
          <DropdownMenuItem disabled>{t("project.noMemberMatch")}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TaskStatusIcon({ status }: { status: ProjectTaskStatus }) {
  switch (status) {
    case "in_progress":
      return <CircleDot aria-hidden="true" className="text-sky-600" />
    case "done":
      return <CircleCheckBig aria-hidden="true" className="text-emerald-600" />
    case "canceled":
      return <CircleX aria-hidden="true" className="text-stone-400" />
    default:
      return <Circle aria-hidden="true" className="text-amber-600" />
  }
}

function TaskPriorityIcon({ priority }: { priority: ProjectTaskPriority }) {
  switch (priority) {
    case 2:
      return <Equal aria-hidden="true" className="text-amber-600" />
    case 3:
      return <ChevronsUp aria-hidden="true" className="text-rose-600" />
    default:
      return <ChevronsDown aria-hidden="true" className="text-muted-foreground" />
  }
}

function FilterButton({
  active,
  className,
  label,
  prefix,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children"> & {
  active: boolean
  label: string
  prefix?: string
}) {
  return (
    <Button
      className={cn(active && "bg-muted", className)}
      {...props}
      type="button"
      variant="outline"
    >
      <span className="min-w-0 truncate">
        {prefix && <span className="text-muted-foreground">{prefix}：</span>}
        {label}
      </span>
      <ChevronDown data-icon="inline-end" />
    </Button>
  )
}

function getFilterLabel<T extends string | number>(
  fallback: string,
  value: T[],
  options: Array<{ label: string; value: T }>,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (value.length === 0) {
    return fallback
  }
  if (value.length === 1) {
    return options.find((option) => option.value === value[0])?.label ?? fallback
  }
  return t("project.assigneeCount", { count: value.length })
}

function updateFilterSelection<T>(value: T[], option: T, checked: boolean) {
  if (checked) {
    return value.includes(option) ? value : [...value, option]
  }
  return value.filter((current) => current !== option)
}

function hasTaskFilters(filters: TaskFilters) {
  return Boolean(
    filters.assigneeUserIds.length ||
    filters.keyword ||
    filters.priorities.length ||
    filters.statuses.length,
  )
}

function TaskViewSwitcher({
  onValueChange,
  value,
}: {
  onValueChange: (view: TaskView) => void
  value: TaskView
}) {
  const { t } = useLocale()
  return (
    <ToggleGroup
      aria-label={t("project.taskView")}
      className="shrink-0"
      onValueChange={(nextValue) => {
        if (nextValue) {
          onValueChange(nextValue as TaskView)
        }
      }}
      spacing={0}
      type="single"
      value={value}
      variant="outline"
    >
      {getTaskViews(t).map((view) => {
        const Icon = view.icon

        return (
          <ToggleGroupItem
            aria-label={view.label}
            key={view.value}
            title={view.label}
            value={view.value}
          >
            <Icon />
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

function TaskViewContent({
  activeView,
  emptyMessage,
  onOpenTask,
  onTaskStatusChange,
  onTaskUpdated,
  tasks,
}: {
  activeView: TaskView
  emptyMessage: string
  onOpenTask: (task: ProjectTask) => void
  onTaskStatusChange: (taskId: string, status: ProjectTaskStatus) => void
  onTaskUpdated: () => Promise<void>
  tasks: ProjectTask[]
}) {
  switch (activeView) {
    case "board":
      return (
        <ProjectTaskBoardView
          emptyMessage={emptyMessage}
          onOpenTask={onOpenTask}
          onTaskStatusChange={onTaskStatusChange}
          onTaskUpdated={onTaskUpdated}
          tasks={tasks}
        />
      )
    case "calendar":
      return (
        <ProjectTaskCalendarView
          emptyMessage={emptyMessage}
          onOpenTask={onOpenTask}
          tasks={tasks}
        />
      )
    case "gantt":
      return (
        <ProjectTaskGanttView emptyMessage={emptyMessage} onOpenTask={onOpenTask} tasks={tasks} />
      )
    default:
      return (
        <ProjectTaskListView
          emptyMessage={emptyMessage}
          onOpenTask={onOpenTask}
          onTaskUpdated={onTaskUpdated}
          tasks={tasks}
        />
      )
  }
}
