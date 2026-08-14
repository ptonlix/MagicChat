import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import {
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Equal,
} from "lucide-react"

import { UpdateProjectTaskAssigneeDialog } from "@/components/projects/update-project-task-assignee-dialog"
import { UpdateProjectTaskDateDialog } from "@/components/projects/update-project-task-date-dialog"
import { UpdateProjectTaskPriorityDialog } from "@/components/projects/update-project-task-priority-dialog"
import { UpdateProjectTaskStatusDialog } from "@/components/projects/update-project-task-status-dialog"
import type { ProjectTask } from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { formatRelativeTime } from "@/lib/relative-time"
import { cn } from "@/lib/utils"
import { displayProjectUser } from "@/lib/project-user-hydration"

export function ProjectTaskListView({
  emptyMessage,
  onOpenTask,
  onTaskUpdated,
  tasks,
}: {
  emptyMessage?: string
  onOpenTask: (task: ProjectTask) => void
  onTaskUpdated: () => Promise<void>
  tasks: ProjectTask[]
}) {
  const { t } = useLocale()

  return (
    <>
      {tasks.length === 0 ? (
        <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <ItemGroup aria-label={t("project.task.list")} className="gap-2">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              onOpenDetails={() => onOpenTask(task)}
              onUpdated={onTaskUpdated}
              task={task}
            />
          ))}
        </ItemGroup>
      )}
    </>
  )
}

function TaskItem({
  onOpenDetails,
  onUpdated,
  task,
}: {
  onOpenDetails: () => void
  onUpdated: () => Promise<void>
  task: ProjectTask
}) {
  const { t } = useLocale()
  const closed = task.status === "done" || task.status === "canceled"
  const assigneeName = task.assignee ? displayProjectUser(task.assignee) : ""
  const overdue = !closed && isPastDate(task.dueDate)
  const now = new Date()
  const [assigneeDialogOpen, setAssigneeDialogOpen] = React.useState(false)
  const [dueDateDialogOpen, setDueDateDialogOpen] = React.useState(false)
  const [priorityDialogOpen, setPriorityDialogOpen] = React.useState(false)
  const [startDateDialogOpen, setStartDateDialogOpen] = React.useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false)

  return (
    <div role="listitem">
      <Item
        className={cn(
          "cursor-pointer items-start bg-background px-3 py-3 shadow-xs hover:bg-muted",
          closed && "bg-muted/40 text-muted-foreground",
        )}
        onClick={onOpenDetails}
        size="sm"
        variant="outline"
      >
        <ItemMedia>
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-sm border",
              task.status === "in_progress"
                ? "border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-950"
                : task.status === "done"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950"
                  : task.status === "canceled"
                    ? "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-950"
                    : "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950",
            )}
          >
            <TaskStatusIcon status={task.status} />
          </div>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle
            className={cn(
              "line-clamp-none w-full transition-colors group-hover/item:text-sky-600",
              closed && "text-muted-foreground",
            )}
          >
            <span className="flex w-full min-w-0 flex-wrap items-center gap-2">
              <button
                aria-label={t("project.task.viewDetail", { title: task.title })}
                className="max-w-full min-w-0 cursor-pointer truncate text-left"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenDetails()
                }}
                type="button"
              >
                {task.title}
              </button>
              {task.labels.map((label) => (
                <Badge
                  className="max-w-40 truncate border-primary/30 bg-primary/10 text-primary dark:bg-primary/15"
                  key={label}
                  variant="secondary"
                >
                  {label}
                </Badge>
              ))}
            </span>
          </ItemTitle>
          <ItemDescription className="line-clamp-1">
            {task.description || t("project.task.noDetail")}
          </ItemDescription>
        </ItemContent>
        <ItemFooter className="flex-wrap justify-start gap-2">
          <StatusBadge
            muted={closed}
            onClick={(event) => {
              event.stopPropagation()
              setStatusDialogOpen(true)
            }}
            status={task.status}
          />
          <PriorityBadge
            muted={closed}
            onClick={(event) => {
              event.stopPropagation()
              setPriorityDialogOpen(true)
            }}
            priority={task.priority}
          />
          {task.assignee && (
            <Badge asChild variant="outline">
              <button
                aria-label={t("project.task.changeAssignee", {
                  name: assigneeName,
                })}
                className={cn(
                  "cursor-pointer hover:ring-1 hover:ring-ring/50",
                  closed && "text-muted-foreground",
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  setAssigneeDialogOpen(true)
                }}
                type="button"
              >
                <Avatar className="size-4 rounded-sm after:rounded-sm">
                  {task.assignee.avatar && (
                    <AvatarImage
                      alt={assigneeName}
                      className="rounded-sm"
                      src={task.assignee.avatar}
                    />
                  )}
                  <AvatarFallback className="rounded-sm text-[8px]">
                    {getUserInitial(assigneeName)}
                  </AvatarFallback>
                </Avatar>
                {assigneeName}
              </button>
            </Badge>
          )}
          <TaskDateBadge
            label={t("project.task.start")}
            onClick={(event) => {
              event.stopPropagation()
              setStartDateDialogOpen(true)
            }}
            value={task.startDate}
          />
          <TaskDateBadge
            label={t("project.task.due")}
            onClick={(event) => {
              event.stopPropagation()
              setDueDateDialogOpen(true)
            }}
            overdue={overdue}
            value={task.dueDate}
          />
          <div className="ml-auto flex shrink-0 items-center text-xs whitespace-nowrap text-muted-foreground">
            <time dateTime={task.createdAt} title={task.createdAt}>
              {t("project.task.created", { time: formatRelativeTime(task.createdAt, now) })}
            </time>
            <span>，</span>
            <time dateTime={task.updatedAt} title={task.updatedAt}>
              {t("project.task.updated", { time: formatRelativeTime(task.updatedAt, now) })}
            </time>
          </div>
        </ItemFooter>
      </Item>
      {statusDialogOpen && (
        <UpdateProjectTaskStatusDialog
          currentStatus={task.status}
          onOpenChange={setStatusDialogOpen}
          onUpdated={onUpdated}
          open
          projectId={task.projectId}
          taskId={task.id}
        />
      )}
      {priorityDialogOpen && (
        <UpdateProjectTaskPriorityDialog
          currentPriority={task.priority}
          onOpenChange={setPriorityDialogOpen}
          onUpdated={onUpdated}
          open
          projectId={task.projectId}
          taskId={task.id}
        />
      )}
      {startDateDialogOpen && (
        <UpdateProjectTaskDateDialog
          currentValue={task.startDate}
          dateType="start"
          onOpenChange={setStartDateDialogOpen}
          onUpdated={onUpdated}
          open
          otherValue={task.dueDate}
          projectId={task.projectId}
          taskId={task.id}
        />
      )}
      {dueDateDialogOpen && (
        <UpdateProjectTaskDateDialog
          currentValue={task.dueDate}
          dateType="due"
          onOpenChange={setDueDateDialogOpen}
          onUpdated={onUpdated}
          open
          otherValue={task.startDate}
          projectId={task.projectId}
          taskId={task.id}
        />
      )}
      {assigneeDialogOpen && (
        <UpdateProjectTaskAssigneeDialog
          currentAssignee={task.assignee}
          onOpenChange={setAssigneeDialogOpen}
          onUpdated={onUpdated}
          open
          projectId={task.projectId}
          taskId={task.id}
        />
      )}
    </div>
  )
}

function getUserInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}

function TaskStatusIcon({
  colored = false,
  status,
}: {
  colored?: boolean
  status: ProjectTask["status"]
}) {
  switch (status) {
    case "in_progress":
      return <CircleDot aria-hidden="true" className={cn("size-4", colored && "text-sky-600")} />
    case "done":
      return (
        <CircleCheckBig
          aria-hidden="true"
          className={cn("size-4", colored && "text-emerald-600")}
        />
      )
    case "canceled":
      return <CircleX aria-hidden="true" className={cn("size-4", colored && "text-stone-400")} />
    default:
      return <Circle aria-hidden="true" className={cn("size-4", colored && "text-amber-600")} />
  }
}

function StatusBadge({
  muted = false,
  onClick,
  status,
}: {
  muted?: boolean
  onClick: React.MouseEventHandler<HTMLButtonElement>
  status: ProjectTask["status"]
}) {
  const { t } = useLocale()
  const statusLabels = {
    todo: t("project.filter.todo"),
    in_progress: t("project.filter.in_progress"),
    done: t("project.filter.done"),
    canceled: t("project.filter.canceled"),
  } satisfies Record<ProjectTask["status"], string>
  return (
    <Badge asChild variant="outline">
      <button
        aria-label={t("project.task.changeStatus", { label: statusLabels[status] })}
        className={cn(
          "cursor-pointer hover:ring-1 hover:ring-ring/50",
          muted && "text-muted-foreground",
        )}
        onClick={onClick}
        type="button"
      >
        <TaskStatusIcon colored status={status} />
        {statusLabels[status]}
      </button>
    </Badge>
  )
}

function PriorityBadge({
  muted = false,
  onClick,
  priority,
}: {
  muted?: boolean
  onClick: React.MouseEventHandler<HTMLButtonElement>
  priority: ProjectTask["priority"]
}) {
  const { t } = useLocale()
  const priorityLabels = {
    1: t("project.priority.low"),
    2: t("project.priority.medium"),
    3: t("project.priority.high"),
  } satisfies Record<ProjectTask["priority"], string>
  return (
    <Badge asChild variant="outline">
      <button
        aria-label={t("project.task.changePriority", { label: priorityLabels[priority] })}
        className={cn(
          "cursor-pointer hover:ring-1 hover:ring-ring/50",
          muted && "text-muted-foreground",
        )}
        onClick={onClick}
        type="button"
      >
        {priority === 3 ? (
          <ChevronsUp aria-hidden="true" className="text-rose-600" />
        ) : priority === 2 ? (
          <Equal aria-hidden="true" className="text-amber-600" />
        ) : (
          <ChevronsDown aria-hidden="true" className="text-muted-foreground" />
        )}
        {priorityLabels[priority]}
      </button>
    </Badge>
  )
}

function TaskDateBadge({
  label,
  onClick,
  overdue = false,
  value,
}: {
  label: string
  onClick: React.MouseEventHandler<HTMLButtonElement>
  overdue?: boolean
  value: string | null
}) {
  const { t } = useLocale()
  if (!value) {
    return null
  }

  return (
    <Badge asChild variant={overdue ? "warning" : "outline"}>
      <button
        aria-label={t("project.task.changeDate", { label, value })}
        className={cn(
          "cursor-pointer hover:ring-1 hover:ring-ring/50",
          overdue && "bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
          !overdue && "text-muted-foreground",
        )}
        onClick={onClick}
        type="button"
      >
        {label} <time dateTime={value}>{value}</time>
      </button>
    </Badge>
  )
}

function isPastDate(value: string | null) {
  if (!value) {
    return false
  }

  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")
  return value < `${year}-${month}-${day}`
}
