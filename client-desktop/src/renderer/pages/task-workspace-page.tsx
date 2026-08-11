import * as React from "react"
import {
  ArrowLeft,
  Building2,
  Circle,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Loader2,
  Plus,
  Search,
} from "lucide-react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { CreateProjectTaskDialog } from "@/components/projects/create-project-task-dialog"
import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
import type { ProjectTask } from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useLocale } from "@/components/locale-provider"
import {
  getClientProject,
  listClientProjects,
  type ClientProjectSummary,
} from "@/lib/project-data-api"
import { getClientProjectTask, listClientProjectTasks } from "@/lib/project-task-data-api"
import { cn } from "@/lib/utils"

const statusLabelKeys = {
  canceled: "project.filter.canceled",
  done: "project.filter.done",
  in_progress: "project.filter.in_progress",
  todo: "project.filter.todo",
} as const satisfies Record<ProjectTask["status"], string>

const taskWorkspaceStatus = {
  loading: "project.loadingTasks",
  noMatch: "project.noTaskMatch",
  noTasks: "project.noTasks",
  retry: "project.reload",
} as const

export function TaskWorkspacePage() {
  const { projectId = "", taskId = "" } = useParams<{ projectId: string; taskId?: string }>()
  if (!projectId) return null
  return <LoadedTaskWorkspace key={projectId} projectId={projectId} taskId={taskId} />
}

function LoadedTaskWorkspace({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { t } = useLocale()
  const navigate = useNavigate()
  const [activeTask, setActiveTask] = React.useState<ProjectTask | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [error, setError] = React.useState("")
  const [keyword, setKeyword] = React.useState("")
  const deferredKeyword = React.useDeferredValue(keyword.trim())
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [projects, setProjects] = React.useState<ClientProjectSummary[]>([])
  const [personalProject, setPersonalProject] = React.useState<ClientProjectSummary | null>(null)
  const [currentProject, setCurrentProject] = React.useState<ClientProjectSummary | null>(null)
  const [projectsLoadingMore, setProjectsLoadingMore] = React.useState(false)
  const [projectsNextCursor, setProjectsNextCursor] = React.useState<string | null>(null)
  const [tasks, setTasks] = React.useState<ProjectTask[]>([])
  const requestIdRef = React.useRef(0)

  const projectOptions = React.useMemo(() => {
    const values = [currentProject, personalProject, ...projects].filter(
      (project): project is ClientProjectSummary => Boolean(project),
    )
    return values.filter(
      (project, index) => values.findIndex((value) => value.id === project.id) === index,
    )
  }, [currentProject, personalProject, projects])

  const loadTasks = React.useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const page = await listClientProjectTasks(projectId, {
        keyword: deferredKeyword || undefined,
        limit: 50,
      })
      if (requestId === requestIdRef.current) {
        setTasks(page.tasks)
        setNextCursor(page.nextCursor)
        setError("")
      }
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("project.loadTasksFailed"))
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [deferredKeyword, projectId, t])

  React.useEffect(() => {
    let active = true
    void listClientProjects({ limit: 100 })
      .then((page) => {
        if (!active) return
        setPersonalProject(page.personalProject)
        setProjects(page.projects)
        setProjectsNextCursor(page.nextCursor)
      })
      .catch((loadError: unknown) => {
        if (active)
          toast.error(
            loadError instanceof Error ? loadError.message : t("taskWorkspace.projectsLoadFailed"),
          )
      })
    void getClientProject(projectId)
      .then((project) => {
        if (active) setCurrentProject(project)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [projectId, t])

  async function loadMoreProjects() {
    if (!projectsNextCursor || projectsLoadingMore) return
    setProjectsLoadingMore(true)
    try {
      const page = await listClientProjects({ cursor: projectsNextCursor, limit: 100 })
      setProjects((current) => [...current, ...page.projects])
      setProjectsNextCursor(page.nextCursor)
    } catch (loadError) {
      toast.error(
        loadError instanceof Error ? loadError.message : t("taskWorkspace.moreProjectsLoadFailed"),
      )
    } finally {
      setProjectsLoadingMore(false)
    }
  }

  React.useEffect(() => {
    void loadTasks()
    return () => {
      requestIdRef.current += 1
    }
  }, [loadTasks])

  React.useEffect(() => {
    if (!taskId || tasks.some((task) => task.id === taskId)) return
    let active = true
    void getClientProjectTask(projectId, taskId)
      .then((task) => {
        if (active) setActiveTask(task)
      })
      .catch((loadError: unknown) => {
        if (active) {
          toast.error(loadError instanceof Error ? loadError.message : t("project.loadTaskFailed"))
          navigate(`/tasks/${encodeURIComponent(projectId)}`, { replace: true })
        }
      })
    return () => {
      active = false
    }
  }, [navigate, projectId, t, taskId, tasks])

  const displayedTask =
    tasks.find((task) => task.id === taskId) ?? (activeTask?.id === taskId ? activeTask : null)

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    const requestId = requestIdRef.current
    setLoadingMore(true)
    try {
      const page = await listClientProjectTasks(projectId, {
        cursor: nextCursor,
        keyword: deferredKeyword || undefined,
        limit: 50,
      })
      if (requestId === requestIdRef.current) {
        setTasks((current) => [...current, ...page.tasks])
        setNextCursor(page.nextCursor)
      }
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        toast.error(
          loadError instanceof Error ? loadError.message : t("taskWorkspace.moreTasksLoadFailed"),
        )
      }
    } finally {
      setLoadingMore(false)
    }
  }

  function openTask(task: ProjectTask) {
    setActiveTask(task)
    navigate(`/tasks/${encodeURIComponent(projectId)}/${encodeURIComponent(task.id)}`)
  }

  function handleTaskDeleted(deletedTaskId: string) {
    setTasks((current) => current.filter((task) => task.id !== deletedTaskId))
    setActiveTask(null)
    navigate(`/tasks/${encodeURIComponent(projectId)}`, { replace: true })
    void loadTasks()
  }

  return (
    <main className="flex h-svh min-w-0 overflow-hidden bg-background pt-10">
      <aside
        className={cn(
          "flex h-full w-full shrink-0 flex-col overflow-hidden border-r bg-background md:w-80",
          taskId && "hidden md:flex",
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-1 px-3">
          <Button
            aria-label={t("taskWorkspace.backToChat")}
            onClick={() => navigate("/chat")}
            size="icon-sm"
            title={t("taskWorkspace.backToChat")}
            type="button"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <Select
              onValueChange={(nextProjectId) => {
                if (nextProjectId === "__load_more_projects__") {
                  void loadMoreProjects()
                  return
                }
                navigate(`/tasks/${encodeURIComponent(nextProjectId)}`)
              }}
              value={projectId}
            >
              <SelectTrigger
                aria-label={t("taskWorkspace.switchProject")}
                className="h-10 w-full border-0 shadow-none"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-teal-500/15 text-teal-700 dark:text-teal-300">
                  <Building2 className="size-4" />
                </span>
                <SelectValue
                  placeholder={
                    projectOptions.find((project) => project.id === projectId)?.name ||
                    t("taskWorkspace.selectProject")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
                {projectsNextCursor && (
                  <SelectItem disabled={projectsLoadingMore} value="__load_more_projects__">
                    {projectsLoadingMore
                      ? t("taskWorkspace.loadingMoreProjects")
                      : t("taskWorkspace.loadMoreProjects")}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid shrink-0 gap-2 px-3 pb-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t("project.searchTasks")}
                className="pl-8"
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("project.searchTasks")}
                value={keyword}
              />
            </div>
            <Button
              aria-label={t("project.createTask")}
              onClick={() => setCreateOpen(true)}
              size="icon"
              title={t("project.createTask")}
              type="button"
            >
              <Plus />
            </Button>
          </div>
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <WorkspaceState loading message={t(taskWorkspaceStatus.loading)} />
          ) : error ? (
            <WorkspaceState message={error}>
              <Button onClick={() => void loadTasks()} size="sm" type="button" variant="outline">
                {t(taskWorkspaceStatus.retry)}
              </Button>
            </WorkspaceState>
          ) : tasks.length === 0 ? (
            <WorkspaceState
              message={t(
                deferredKeyword ? taskWorkspaceStatus.noMatch : taskWorkspaceStatus.noTasks,
              )}
            />
          ) : (
            <div aria-label={t("project.task.list")} className="grid gap-1" role="list">
              {tasks.map((task) => (
                <WorkspaceTaskItem
                  active={task.id === taskId}
                  key={task.id}
                  onClick={() => openTask(task)}
                  task={task}
                  translate={t}
                />
              ))}
              {nextCursor && (
                <Button
                  className="mx-auto mt-2"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {loadingMore && <Loader2 className="animate-spin" />}
                  {t("project.loadMore")}
                </Button>
              )}
            </div>
          )}
        </div>
      </aside>
      <section
        className={cn(
          "min-w-0 flex-1 overflow-auto bg-background p-4",
          !taskId && "hidden md:flex",
        )}
      >
        {taskId && displayedTask ? (
          <ProjectTaskDetailsDialog
            embedded
            key={displayedTask.id}
            onDeleted={handleTaskDeleted}
            onOpenChange={(open) => {
              if (!open) navigate(`/tasks/${encodeURIComponent(projectId)}`)
            }}
            onUpdated={loadTasks}
            open
            task={displayedTask}
          />
        ) : taskId ? (
          <WorkspaceState loading message={t("taskWorkspace.loadingTask")} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("taskWorkspace.selectTask")}
          </div>
        )}
      </section>
      <CreateProjectTaskDialog
        onCreated={loadTasks}
        onOpenChange={setCreateOpen}
        open={createOpen}
        projectId={projectId}
      />
    </main>
  )
}

function WorkspaceTaskItem({
  active,
  onClick,
  task,
  translate,
}: {
  active: boolean
  onClick: () => void
  task: ProjectTask
  translate: ReturnType<typeof useLocale>["t"]
}) {
  const assigneeName = task.assignee?.nickname || task.assignee?.name || ""
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "grid w-full gap-1.5 rounded-md px-3 py-2.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active && "bg-teal-100 hover:bg-teal-100 dark:bg-teal-900 dark:hover:bg-teal-900",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <TaskStatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
        {task.priority === 3 && (
          <Badge variant="destructive">{translate("project.priority.high")}</Badge>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2 pl-6 text-xs text-muted-foreground">
        <span>{translate(statusLabelKeys[task.status])}</span>
        {task.dueDate && (
          <span>{translate("project.task.dueDate", { date: task.dueDate.slice(5) })}</span>
        )}
        {task.assignee && (
          <span className="ml-auto flex min-w-0 items-center gap-1">
            <Avatar className="size-4">
              {task.assignee.avatar && (
                <AvatarImage alt={assigneeName} src={task.assignee.avatar} />
              )}
              <AvatarFallback className="text-[8px]">
                {Array.from(assigneeName)[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-20 truncate">{assigneeName}</span>
          </span>
        )}
      </span>
    </button>
  )
}

function TaskStatusIcon({ status }: { status: ProjectTask["status"] }) {
  const className = "size-4 shrink-0"
  if (status === "in_progress") return <CircleDot className={cn(className, "text-sky-600")} />
  if (status === "done") return <CircleCheckBig className={cn(className, "text-emerald-600")} />
  if (status === "canceled") return <CircleX className={cn(className, "text-stone-500")} />
  return <Circle className={cn(className, "text-amber-600")} />
}

function WorkspaceState({
  children,
  loading = false,
  message,
}: {
  children?: React.ReactNode
  loading?: boolean
  message: string
}) {
  return (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      {loading && <Loader2 className="size-4 animate-spin" />}
      <span>{message}</span>
      {children}
    </div>
  )
}
