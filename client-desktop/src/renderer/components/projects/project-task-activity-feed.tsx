import * as React from "react"
import { MessageSquare, RefreshCw } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

import { useLocale } from "@/components/locale-provider"
import type {
  ProjectTaskActivity,
  ProjectTaskActivityChange,
} from "@/components/projects/project-types"
import { MessageMarkdown } from "@/components/message-markdown"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { formatActivityTime } from "@/lib/activity-time"
import type { TranslationKey } from "@/lib/i18n"
import {
  addClientProjectTaskComment,
  listClientProjectTaskActivities,
} from "@/lib/project-task-data-api"

export function ProjectTaskActivityFeed({
  assigneeNames = {},
  disabled,
  projectId,
  revision,
  taskId,
}: {
  assigneeNames?: Record<string, string>
  disabled?: boolean
  projectId: string
  revision: string
  taskId: string
}) {
  const { t } = useLocale()
  const [activities, setActivities] = React.useState<ProjectTaskActivity[]>([])
  const [comment, setComment] = React.useState("")
  const [error, setError] = React.useState("")
  const [expanded, setExpanded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingOlder, setLoadingOlder] = React.useState(false)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const activityRequestIdRef = React.useRef(0)
  const visibleActivities = expanded ? activities : activities.slice(-20)
  const canExpand = (!expanded && activities.length > 20) || nextCursor !== null

  const loadActivities = React.useCallback(async () => {
    const requestId = ++activityRequestIdRef.current
    setLoading(true)
    try {
      const page = await listClientProjectTaskActivities(projectId, taskId)
      if (requestId === activityRequestIdRef.current) {
        setActivities((current) => mergeActivities(current, page.activities))
        setExpanded(false)
        setNextCursor(page.nextCursor)
        setError("")
      }
    } catch (loadError) {
      if (requestId === activityRequestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("taskActivity.loadFailed"))
      }
    } finally {
      if (requestId === activityRequestIdRef.current) setLoading(false)
    }
  }, [projectId, t, taskId])

  React.useEffect(() => {
    void loadActivities()
    return () => {
      activityRequestIdRef.current += 1
    }
  }, [loadActivities, revision])

  async function handleLoadOlder() {
    if (!expanded && activities.length > 20) {
      setExpanded(true)
      return
    }
    if (!nextCursor || loadingOlder) return
    const requestId = activityRequestIdRef.current
    setLoadingOlder(true)
    try {
      const page = await listClientProjectTaskActivities(projectId, taskId, {
        cursor: nextCursor,
      })
      if (requestId === activityRequestIdRef.current) {
        setActivities((current) => mergeActivities(current, page.activities))
        setExpanded(true)
        setNextCursor(page.nextCursor)
      }
    } catch (loadError) {
      if (requestId === activityRequestIdRef.current) {
        toast.error(
          loadError instanceof Error ? loadError.message : t("taskActivity.olderLoadFailed"),
        )
      }
    } finally {
      setLoadingOlder(false)
    }
  }

  async function handleSubmit() {
    const content = comment.trim()
    if (!content || loading || submitting) return
    setSubmitting(true)
    try {
      const activity = await addClientProjectTaskComment(projectId, taskId, content)
      setActivities((current) => mergeActivities(current, [activity]))
      setComment("")
      setError("")
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : t("taskActivity.submitFailed"),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section aria-label={t("taskActivity.ariaLabel")} className="grid min-w-0 gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("taskActivity.title")}</h3>
        {loading && <Spinner />}
      </div>
      <div className="min-h-36 border-y py-3">
        {error ? (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-sm text-destructive">
            <span>{error}</span>
            <Button onClick={() => void loadActivities()} size="sm" type="button" variant="outline">
              <RefreshCw />
              {t("taskActivity.retry")}
            </Button>
          </div>
        ) : !loading && activities.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <MessageSquare />
            <span>{t("taskActivity.empty")}</span>
          </div>
        ) : (
          <div className="grid gap-4 py-1">
            {canExpand && (
              <Button
                className="mx-auto"
                disabled={loadingOlder}
                onClick={() => void handleLoadOlder()}
                size="sm"
                type="button"
                variant="ghost"
              >
                {loadingOlder && <Spinner />}
                {t("taskActivity.expandOlder")}
              </Button>
            )}
            {visibleActivities.map((activity) => (
              <TaskActivityItem
                activity={activity}
                assigneeNames={assigneeNames}
                key={activity.id}
                translate={t}
              />
            ))}
          </div>
        )}
      </div>
      <InputGroup>
        <InputGroupTextarea
          aria-label={t("taskActivity.commentAria")}
          className="min-h-12!"
          disabled={disabled || loading || submitting}
          maxLength={10000}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            if (submitting) {
              event.preventDefault()
              return
            }
            if (event.shiftKey || event.ctrlKey) {
              event.preventDefault()
              const target = event.currentTarget
              const start = target.selectionStart
              const end = target.selectionEnd
              const nextComment = `${comment.slice(0, start)}\n${comment.slice(end)}`
              setComment(nextComment)
              requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1))
              return
            }
            event.preventDefault()
            void handleSubmit()
          }}
          placeholder={t("taskActivity.commentPlaceholder")}
          rows={1}
          value={comment}
        />
        <InputGroupAddon align="block-end" className="justify-end">
          <InputGroupButton
            disabled={disabled || loading || submitting || !comment.trim()}
            onClick={() => void handleSubmit()}
            size="sm"
            variant="default"
          >
            {submitting ? <Spinner /> : <MessageSquare />}
            {t("taskActivity.comment")}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </section>
  )
}

function TaskActivityItem({
  activity,
  assigneeNames,
  translate,
}: {
  activity: ProjectTaskActivity
  assigneeNames: Record<string, string>
  translate: ReturnType<typeof useLocale>["t"]
}) {
  const name = activity.actor.nickname || activity.actor.name
  return (
    <article className="text-sm">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <Link
          className="font-medium hover:text-primary"
          to={`/contacts/user/${encodeURIComponent(activity.actor.id)}`}
        >
          {name}
        </Link>
        <span className="text-muted-foreground">
          {getActivitySummary(activity, assigneeNames, translate)}
        </span>
        <time
          className="ml-auto shrink-0 text-xs text-muted-foreground"
          dateTime={activity.createdAt}
        >
          {formatActivityTime(activity.createdAt)}
        </time>
      </div>
      {activity.type === "commented" && (
        <div className="mt-1 rounded-md bg-muted/60 px-3 py-2 break-words">
          <MessageMarkdown content={activity.content} />
        </div>
      )}
    </article>
  )
}

function getActivitySummary(
  activity: ProjectTaskActivity,
  assigneeNames: Record<string, string>,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (activity.type === "created") return t("taskActivity.created")
  if (activity.type === "commented") return t("taskActivity.commented")
  if (activity.changes.length === 0) return t("taskActivity.updated")
  return (
    <>
      {t("taskActivity.changedPrefix")}{" "}
      {activity.changes.map((change, index) => (
        <React.Fragment key={`${change.field}-${index}`}>
          {index > 0 && t("taskActivity.separator")}
          <strong className="font-semibold text-foreground">
            {getChangedFieldLabel(change.field, t)}
          </strong>
          {change.field !== "description" && (
            <>
              {" "}
              {t("taskActivity.changedTo")}{" "}
              <strong className="font-semibold text-foreground">
                {formatChangedValue(change, assigneeNames, t)}
              </strong>
            </>
          )}
        </React.Fragment>
      ))}
    </>
  )
}

function getChangedFieldLabel(field: string, t: ReturnType<typeof useLocale>["t"]) {
  const fieldKeys: Record<string, TranslationKey> = {
    assignee: "taskActivity.field.assignee",
    description: "taskActivity.field.description",
    due_date: "taskActivity.field.dueDate",
    labels: "taskActivity.field.labels",
    priority: "taskActivity.field.priority",
    reminder: "taskActivity.field.reminder",
    start_date: "taskActivity.field.startDate",
    status: "taskActivity.field.status",
    title: "taskActivity.field.title",
  }
  return t(fieldKeys[field] ?? "taskActivity.field.task")
}

function formatChangedValue(
  change: ProjectTaskActivityChange,
  assigneeNames: Record<string, string>,
  t: ReturnType<typeof useLocale>["t"],
) {
  const value = change.to
  if (value === null || value === undefined || value === "") return t("taskActivity.value.unset")
  if (change.field === "status" && typeof value === "string")
    return (
      (
        {
          canceled: t("project.filter.canceled"),
          done: t("project.filter.done"),
          in_progress: t("project.filter.in_progress"),
          todo: t("project.filter.todo"),
        } as Record<string, string>
      )[value] ?? value
    )
  if (change.field === "priority" && typeof value === "number")
    return (
      (
        {
          1: t("project.priority.low"),
          2: t("project.priority.medium"),
          3: t("project.priority.high"),
        } as Record<number, string>
      )[value] ?? String(value)
    )
  if (change.field === "assignee") {
    if (typeof value === "string") {
      return assigneeNames[value] ?? t("taskActivity.value.unknownContact")
    }
    if (typeof value === "object" && value !== null) {
      const user = value as { id?: unknown; name?: unknown; nickname?: unknown }
      if (typeof user.nickname === "string" && user.nickname) return user.nickname
      if (typeof user.name === "string" && user.name) return user.name
      if (typeof user.id === "string" && assigneeNames[user.id]) return assigneeNames[user.id]
    }
    return t("taskActivity.value.unknownContact")
  }
  if (change.field === "labels" && Array.isArray(value)) {
    const labels = value.filter((item): item is string => typeof item === "string")
    return labels.length > 0
      ? labels.join(t("taskActivity.separator"))
      : t("taskActivity.value.noLabels")
  }
  if (change.field === "reminder" && typeof value === "object") {
    const reminder = value as { at?: unknown; frequency?: unknown; time?: unknown }
    if (typeof reminder.at === "string") return reminder.at.replace("T", " ").slice(0, 16)
    if (typeof reminder.frequency === "string") {
      const frequencyKeys: Record<string, TranslationKey> = {
        daily: "taskActivity.frequency.daily",
        monthly: "taskActivity.frequency.monthly",
        weekly: "taskActivity.frequency.weekly",
      }
      const frequencyKey = frequencyKeys[reminder.frequency]
      const frequency = frequencyKey ? t(frequencyKey) : reminder.frequency
      return typeof reminder.time === "string" ? `${frequency} ${reminder.time}` : frequency
    }
    return t("taskActivity.value.configured")
  }
  if (change.field === "title" && typeof value === "string") {
    return t("taskActivity.value.title", { value })
  }
  return String(value)
}

function mergeActivities(
  current: ProjectTaskActivity[],
  incoming: ProjectTaskActivity[],
): ProjectTaskActivity[] {
  const byId = new Map(current.map((activity) => [activity.id, activity]))
  for (const activity of incoming) byId.set(activity.id, activity)
  return [...byId.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
}
