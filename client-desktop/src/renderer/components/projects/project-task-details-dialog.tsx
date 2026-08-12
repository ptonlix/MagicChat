import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import {
  ArrowLeft,
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Ellipsis,
  Equal,
  Eye,
  Pencil,
  Send,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { ProjectMemberCombobox } from "@/components/projects/project-member-combobox"
import { ProjectTaskActivityFeed } from "@/components/projects/project-task-activity-feed"
import { ProjectTaskDatePicker } from "@/components/projects/project-task-date-picker"
import { ProjectTaskLabelsCombobox } from "@/components/projects/project-task-labels-combobox"
import { ProjectTaskReminderField } from "@/components/projects/project-task-reminder-field"
import { SendCardDialog } from "@/components/conversation/send-card-dialog"
import { MessageMarkdown } from "@/components/message-markdown"
import type {
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskReminderInput,
  ProjectTaskStatus,
} from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ClientProjectMember } from "@/lib/project-data-api"
import { listAllClientProjectMembers } from "@/lib/project-members"
import { useOptionalClientData } from "@/lib/client-data-context"
import {
  displayProjectUser,
  EMPTY_PROJECT_USERS,
  getProjectMemberUserIds,
  hydrateProjectMembers,
  hydrateProjectTask,
} from "@/lib/project-user-hydration"
import {
  deleteClientProjectTask,
  getClientProjectTask,
  listClientProjectTasks,
  type UpdateClientProjectTaskInput,
  updateClientProjectTask,
} from "@/lib/project-task-data-api"

type TaskEditForm = {
  assigneeUserId: string
  description: string
  dueDate: string
  labels: string[]
  priority: ProjectTaskPriority
  reminder: ProjectTaskReminderInput | null
  startDate: string
  status: ProjectTaskStatus
  title: string
}

type NormalizedTaskEditForm = {
  assigneeUserId: string | null
  description: string
  dueDate: string | null
  labels: string[]
  priority: ProjectTaskPriority
  reminder: ProjectTaskReminderInput | null
  startDate: string | null
  status: ProjectTaskStatus
  title: string
}

export function ProjectTaskDetailsDialog({
  embedded = false,
  onDeleted,
  onOpenChange,
  onUpdated,
  open,
  task,
}: {
  embedded?: boolean
  onDeleted?: (taskId: string) => void
  onOpenChange: (open: boolean) => void
  onUpdated?: () => Promise<void>
  open: boolean
  task: ProjectTask
}) {
  const { t } = useLocale()
  const clientData = useOptionalClientData()
  const ensureUsers = clientData?.ensureUsers
  const usersById = clientData?.usersById ?? EMPTY_PROJECT_USERS
  const initialForm = createTaskEditForm(task)
  const [baseline, setBaseline] = React.useState<NormalizedTaskEditForm>(() =>
    normalizeTaskEditForm(initialForm),
  )
  const [details, setDetails] = React.useState(task)
  const [descriptionEditing, setDescriptionEditing] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState("")
  const [form, setForm] = React.useState<TaskEditForm>(initialForm)
  const [loading, setLoading] = React.useState(true)
  const [labelOptions, setLabelOptions] = React.useState<string[]>([])
  const [labelsError, setLabelsError] = React.useState("")
  const [labelsLoading, setLabelsLoading] = React.useState(true)
  const [members, setMembers] = React.useState<ClientProjectMember[]>([])
  const [membersError, setMembersError] = React.useState("")
  const [membersLoading, setMembersLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState(task.title)
  const [titleEditing, setTitleEditing] = React.useState(false)
  const [titleSaving, setTitleSaving] = React.useState(false)
  const assigneeComboboxPortal = React.useRef<HTMLDivElement | null>(null)
  const savingRef = React.useRef(false)

  React.useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    void getClientProjectTask(task.projectId, task.id)
      .then((nextDetails) => {
        if (!active) {
          return
        }
        const loadedForm = createTaskEditForm(nextDetails)
        setBaseline(normalizeTaskEditForm(loadedForm))
        setDetails(nextDetails)
        setDescriptionEditing(false)
        setForm(loadedForm)
        setTitleDraft(nextDetails.title)
        setTitleEditing(false)
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : t("taskDetail.loadFailed"))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    void listAllClientProjectMembers(task.projectId)
      .then((nextMembers) => {
        if (active) {
          setMembers(nextMembers.filter((member) => member.status === "active"))
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setMembersError(
            loadError instanceof Error ? loadError.message : t("taskDetail.membersLoadFailed"),
          )
        }
      })
      .finally(() => {
        if (active) {
          setMembersLoading(false)
        }
      })

    void listAllProjectTaskLabels(task.projectId, task.id)
      .then((nextLabels) => {
        if (active) {
          setLabelOptions(nextLabels)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setLabelsError(
            loadError instanceof Error ? loadError.message : t("taskDetail.labelsLoadFailed"),
          )
        }
      })
      .finally(() => {
        if (active) {
          setLabelsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [open, task.id, task.projectId, t])

  const normalizedForm = normalizeTaskEditForm(form)
  const validationError = getTaskEditValidationError(normalizedForm, t)
  const descriptionDirty = form.description !== baseline.description
  const detailsUserIds = React.useMemo(
    () => [details.creator.id, details.assignee?.id ?? ""].filter(Boolean),
    [details.assignee?.id, details.creator.id],
  )
  const detailsUserKey = detailsUserIds.join("\u0000")
  React.useEffect(() => {
    if (detailsUserKey) void ensureUsers?.(detailsUserIds).catch(() => undefined)
  }, [detailsUserIds, detailsUserKey, ensureUsers])
  const hydratedDetails = React.useMemo(
    () => hydrateProjectTask(details, usersById),
    [details, usersById],
  )
  const memberUserIds = React.useMemo(() => getProjectMemberUserIds(members), [members])
  const memberUserKey = memberUserIds.join("\u0000")
  React.useEffect(() => {
    if (memberUserKey) void ensureUsers?.(memberUserIds).catch(() => undefined)
  }, [ensureUsers, memberUserIds, memberUserKey])
  const hydratedMembers = React.useMemo(
    () => hydrateProjectMembers(members, usersById),
    [members, usersById],
  )
  const assigneeNames = React.useMemo(
    () => Object.fromEntries(hydratedMembers.map((member) => [member.id, member.displayName])),
    [hydratedMembers],
  )
  const fallbackAssignee = createFallbackProjectMember(hydratedDetails)
  const memberOptions =
    fallbackAssignee && !hydratedMembers.some((member) => member.id === fallbackAssignee.id)
      ? [fallbackAssignee, ...hydratedMembers]
      : hydratedMembers
  const selectedAssignee = memberOptions.find((member) => member.id === form.assigneeUserId)
  const card = {
    entityId: details.id,
    entityType: "task",
    type: "entity_card",
  } as const

  function updateForm<K extends keyof TaskEditForm>(field: K, value: TaskEditForm[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function saveImmediateField<K extends keyof TaskEditForm>(
    field: K,
    value: TaskEditForm[K],
    input: UpdateClientProjectTaskInput,
    successMessage: string,
  ) {
    if (savingRef.current || titleSaving || deleting) return
    const nextForm = { ...form, [field]: value }
    const nextNormalized = normalizeTaskEditForm(nextForm)
    const validationMessage = getTaskEditValidationError(nextNormalized, t)
    if (validationMessage) {
      toast.error(validationMessage)
      return
    }
    setForm(nextForm)
    const comparison = { ...baseline, [field]: nextNormalized[field] }
    if (taskEditFormsEqual(comparison, baseline)) return
    void persistTaskFields(input, [field], successMessage, form)
  }

  async function persistTaskFields(
    input: UpdateClientProjectTaskInput,
    fields: Array<keyof TaskEditForm>,
    successMessage: string,
    previousForm = form,
  ) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const updatedTask = await updateClientProjectTask(task.projectId, task.id, input)
      const updatedForm = createTaskEditForm(updatedTask)
      const updatedNormalized = normalizeTaskEditForm(updatedForm)
      setBaseline((current) => mergeTaskEditFields(current, updatedNormalized, fields))
      setDetails(updatedTask)
      setError("")
      setForm((current) => mergeTaskEditFields(current, updatedForm, fields))
      toast.success(successMessage)
      await onUpdated?.()
    } catch (saveError) {
      setForm((current) => mergeTaskEditFields(current, previousForm, fields))
      toast.error(saveError instanceof Error ? saveError.message : t("taskDetail.saveFailed"))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saving || titleSaving || deleting) {
      return
    }
    if (!nextOpen) {
      const resetForm = createTaskEditForm(details)
      setBaseline(normalizeTaskEditForm(resetForm))
      setDescriptionEditing(false)
      setDeleteDialogOpen(false)
      setError("")
      setForm(resetForm)
      setLoading(true)
      setLabelOptions([])
      setLabelsError("")
      setLabelsLoading(true)
      setMembers([])
      setMembersError("")
      setMembersLoading(true)
      setSendDialogOpen(false)
      setTitleDraft(details.title)
      setTitleEditing(false)
    }
    onOpenChange(nextOpen)
  }

  function saveDescription() {
    if (!descriptionDirty || savingRef.current || titleSaving) return
    void persistTaskFields(
      { description: form.description },
      ["description"],
      t("taskDetail.saved"),
    )
  }

  async function saveTitle() {
    if (titleSaving || savingRef.current) return
    const nextTitle = titleDraft.trim()
    if (!nextTitle) {
      toast.error(t("taskDetail.validate.title"))
      setTitleDraft(form.title)
      setTitleEditing(false)
      return
    }
    if (Array.from(nextTitle).length > 240) {
      toast.error(t("taskDetail.validate.title"))
      return
    }
    if (nextTitle === baseline.title) {
      setTitleDraft(baseline.title)
      setForm((current) => ({ ...current, title: baseline.title }))
      setTitleEditing(false)
      return
    }

    setTitleSaving(true)
    try {
      const updatedTask = await updateClientProjectTask(task.projectId, task.id, {
        title: nextTitle,
      })
      const savedTitle = updatedTask.title.trim()
      setBaseline((current) => ({ ...current, title: savedTitle }))
      setDetails(updatedTask)
      setForm((current) => ({ ...current, title: savedTitle }))
      setTitleDraft(savedTitle)
      setTitleEditing(false)
      toast.success(t("taskDetail.saved"))
      await onUpdated?.()
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : t("taskDetail.saveFailed"))
    } finally {
      setTitleSaving(false)
    }
  }

  async function handleDelete() {
    if (deleting || saving || titleSaving) return
    setDeleting(true)
    try {
      const deletedTaskId = await deleteClientProjectTask(task.projectId, task.id)
      toast.success(t("taskDetail.deleted"))
      setDeleteDialogOpen(false)
      onOpenChange(false)
      onDeleted?.(deletedTaskId)
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : t("taskDetail.deleteFailed"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog
      modal={!embedded}
      onOpenChange={(nextOpen) => {
        if (!embedded) handleOpenChange(nextOpen)
      }}
      open={open}
    >
      <DialogContent
        className={
          embedded
            ? "h-full w-full flex-1 content-start gap-5 overflow-y-auto bg-background p-4 sm:p-6"
            : "max-h-[85vh] gap-5 overflow-y-auto sm:max-w-5xl"
        }
        embedded={embedded}
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={!embedded}
      >
        <DialogHeader
          className={
            embedded
              ? "-mx-4 -mt-4 grid! h-14 shrink-0 items-center border-b px-4 sm:-mx-6 sm:-mt-6 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-6"
              : undefined
          }
        >
          <DialogTitle className="flex min-w-0 items-center gap-2">
            {embedded && (
              <Button
                aria-label={t("taskDetail.backToList")}
                className="md:hidden"
                onClick={() => handleOpenChange(false)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ArrowLeft />
              </Button>
            )}
            {titleEditing ? (
              <Input
                aria-label={t("taskDetail.field.title")}
                autoFocus
                className="h-9 min-w-0 flex-1 text-base font-medium"
                disabled={loading || saving || titleSaving || deleting}
                maxLength={240}
                onBlur={() => void saveTitle()}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setTitleDraft(form.title)
                    setTitleEditing(false)
                  }
                }}
                value={titleDraft}
              />
            ) : (
              <button
                className="w-fit max-w-full min-w-0 truncate py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
                disabled={loading || saving || titleSaving || deleting}
                onClick={() => setTitleEditing(true)}
                title={t("taskDetail.field.title")}
                type="button"
              >
                {form.title}
              </button>
            )}
            {(loading || titleSaving) && <Spinner />}
          </DialogTitle>
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t("taskDetail.moreActions")}
                  disabled={loading || saving || titleEditing || titleSaving || deleting}
                  size="icon-sm"
                  title={t("taskDetail.moreActions")}
                  type="button"
                  variant="ghost"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  disabled={descriptionDirty || Boolean(error)}
                  onSelect={() => {
                    requestAnimationFrame(() => setSendDialogOpen(true))
                  }}
                >
                  <Send />
                  {t("taskDetail.sendToChat")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDeleteDialogOpen(true)} variant="destructive">
                  <Trash2 />
                  {t("taskDetail.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DialogDescription className="sr-only">{t("taskDetail.desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
            <div className="grid min-w-0 content-start gap-5">
              <TaskField
                action={
                  <div className="flex shrink-0 items-center gap-2">
                    {descriptionDirty && (
                      <Button
                        disabled={saving || titleSaving || Boolean(validationError)}
                        onClick={saveDescription}
                        size="xs"
                        type="button"
                      >
                        {saving && <Spinner />}
                        {t("taskDetail.save")}
                      </Button>
                    )}
                    <ToggleGroup
                      aria-label={t("taskDetail.detailMode")}
                      className="shrink-0"
                      disabled={loading || saving || titleSaving}
                      onValueChange={(value) => {
                        if (value) setDescriptionEditing(value === "source")
                      }}
                      spacing={0}
                      type="single"
                      value={descriptionEditing ? "source" : "preview"}
                      variant="outline"
                    >
                      <ToggleGroupItem
                        aria-label={t("taskDetail.preview")}
                        className="h-6 min-w-0 px-2 data-[state=off]:text-muted-foreground"
                        title={t("taskDetail.previewLabel")}
                        value="preview"
                      >
                        <Eye className="size-3.5" />
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        aria-label={t("taskDetail.editSource")}
                        className="h-6 min-w-0 px-2 data-[state=off]:text-muted-foreground"
                        title={t("taskDetail.editLabel")}
                        value="source"
                      >
                        <Pencil className="size-3.5" />
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                }
                htmlFor={descriptionEditing ? "task-details-description" : undefined}
                label={t("taskDetail.detail")}
              >
                {descriptionEditing ? (
                  <Textarea
                    autoFocus
                    className="field-sizing-fixed h-[60vh] max-h-[60vh] min-h-[60vh] resize-none font-mono!"
                    disabled={loading || saving || titleSaving}
                    id="task-details-description"
                    onChange={(event) => updateForm("description", event.target.value)}
                    placeholder={t("taskDetail.detailPlaceholder")}
                    value={form.description}
                  />
                ) : (
                  <div
                    className="rounded-md border border-input bg-transparent text-sm shadow-xs dark:bg-input/30"
                    data-slot="task-description-preview"
                  >
                    <div className="px-2.5 py-2 contain-content">
                      {form.description.trim() ? (
                        <MessageMarkdown content={form.description} />
                      ) : (
                        <span className="text-muted-foreground">{t("taskDetail.noDetail")}</span>
                      )}
                    </div>
                  </div>
                )}
              </TaskField>

              <ProjectTaskActivityFeed
                assigneeNames={assigneeNames}
                disabled={loading || saving || titleSaving || deleting}
                projectId={task.projectId}
                revision={details.updatedAt}
                taskId={task.id}
              />
            </div>

            <div className="grid min-w-0 content-start gap-5">
              <div className="grid gap-4">
                <TaskField label={t("taskDetail.field.labels")}>
                  <ProjectTaskLabelsCombobox
                    disabled={loading || saving || titleSaving}
                    loading={labelsLoading}
                    onValueChange={(labels) =>
                      saveImmediateField(
                        "labels",
                        labels,
                        { labels: normalizeLabels(labels) },
                        t("taskDetail.saved"),
                      )
                    }
                    options={labelOptions}
                    portalContainer={assigneeComboboxPortal}
                    value={form.labels}
                  />
                  {labelsError && <p className="text-xs text-destructive">{labelsError}</p>}
                </TaskField>

                <TaskField label={t("taskDetail.field.status")}>
                  <Select
                    disabled={loading || saving || titleSaving}
                    onValueChange={(value) => {
                      const status = value as ProjectTaskStatus
                      saveImmediateField("status", status, { status }, t("taskDetail.saved"))
                    }}
                    value={form.status}
                  >
                    <SelectTrigger aria-label={t("taskDetail.field.status")} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">
                        <Circle className="text-amber-600" />
                        {t("project.filter.todo")}
                      </SelectItem>
                      <SelectItem value="in_progress">
                        <CircleDot className="text-sky-600" />
                        {t("project.filter.in_progress")}
                      </SelectItem>
                      <SelectItem value="done">
                        <CircleCheckBig className="text-emerald-600" />
                        {t("project.filter.done")}
                      </SelectItem>
                      <SelectItem value="canceled">
                        <CircleX className="text-stone-500" />
                        {t("project.filter.canceled")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TaskField>

                <TaskField label={t("taskDetail.field.creator")}>
                  <DisabledUserInput user={hydratedDetails.creator} />
                </TaskField>

                <TaskField label={t("taskDetail.field.priority")}>
                  <Select
                    disabled={loading || saving || titleSaving}
                    onValueChange={(value) => {
                      const priority = Number(value) as ProjectTaskPriority
                      saveImmediateField("priority", priority, { priority }, t("taskDetail.saved"))
                    }}
                    value={String(form.priority)}
                  >
                    <SelectTrigger aria-label={t("taskDetail.field.priority")} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">
                        <ChevronsUp className="text-rose-600" />
                        {t("project.priority.high")}
                      </SelectItem>
                      <SelectItem value="2">
                        <Equal className="text-amber-600" />
                        {t("project.priority.medium")}
                      </SelectItem>
                      <SelectItem value="1">
                        <ChevronsDown className="text-muted-foreground" />
                        {t("project.priority.low")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TaskField>
              </div>

              <div className="grid gap-4">
                <TaskField label={t("taskDetail.field.assignee")}>
                  <ProjectMemberCombobox
                    disabled={loading || saving || titleSaving || membersLoading}
                    loading={membersLoading}
                    members={memberOptions}
                    onValueChange={(member: ClientProjectMember | null) => {
                      const assigneeUserId = member?.id ?? ""
                      saveImmediateField(
                        "assigneeUserId",
                        assigneeUserId,
                        { assigneeUserId: assigneeUserId || null },
                        t("taskDetail.saved"),
                      )
                    }}
                    portalContainer={assigneeComboboxPortal}
                    showEmptyEmail={false}
                    value={selectedAssignee ?? null}
                  />
                  {membersError && <p className="text-xs text-destructive">{membersError}</p>}
                </TaskField>
              </div>

              <div className="grid gap-4">
                <TaskField label={t("taskDetail.field.startDate")}>
                  <ProjectTaskDatePicker
                    disabled={loading || saving || titleSaving}
                    label={t("taskDetail.field.startDate")}
                    maximum={form.dueDate || undefined}
                    onValueChange={(value) =>
                      saveImmediateField(
                        "startDate",
                        value,
                        { startDate: value || null },
                        t("taskDetail.saved"),
                      )
                    }
                    value={form.startDate}
                  />
                </TaskField>
                <TaskField label={t("taskDetail.field.dueDate")}>
                  <ProjectTaskDatePicker
                    disabled={loading || saving || titleSaving}
                    label={t("taskDetail.field.dueDate")}
                    minimum={form.startDate || undefined}
                    onValueChange={(value) =>
                      saveImmediateField(
                        "dueDate",
                        value,
                        { dueDate: value || null },
                        t("taskDetail.saved"),
                      )
                    }
                    value={form.dueDate}
                  />
                </TaskField>
                <TaskField label={t("taskDetail.field.reminder")}>
                  <ProjectTaskReminderField
                    disabled={loading || saving || titleSaving}
                    onValueChange={(value) =>
                      saveImmediateField(
                        "reminder",
                        value,
                        { reminder: value },
                        t("taskDetail.saved"),
                      )
                    }
                    state={
                      details.status === form.status &&
                      reminderInputsEqual(form.reminder, toReminderInput(details.reminder))
                        ? details.reminder?.state
                        : undefined
                    }
                    status={form.status}
                    value={form.reminder}
                  />
                </TaskField>
              </div>

              {(validationError || error) && (
                <p className="text-xs text-destructive">{validationError || error}</p>
              )}
            </div>
          </div>
        </div>
        <div className="absolute top-0 left-0 size-0" ref={assigneeComboboxPortal} />
      </DialogContent>
      <SendCardDialog card={card} onOpenChange={setSendDialogOpen} open={sendDialogOpen} />
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!deleting) setDeleteDialogOpen(nextOpen)
        }}
        open={deleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("taskDetail.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("taskDetail.delete.desc", { title: details.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("project.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
              variant="destructive"
            >
              {deleting && <Spinner />}
              {t("taskDetail.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

function TaskField({
  action,
  children,
  htmlFor,
  label,
}: {
  action?: React.ReactNode
  children: React.ReactNode
  htmlFor?: string
  label: string
}) {
  return (
    <div className="grid content-start gap-2">
      {action ? (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={htmlFor}>{label}</Label>
          {action}
        </div>
      ) : (
        <Label htmlFor={htmlFor}>{label}</Label>
      )}
      {children}
    </div>
  )
}

function DisabledUserInput({ user }: { user: ProjectTask["creator"] }) {
  const { t } = useLocale()
  const displayName = displayProjectUser(user)
  const initial = Array.from(displayName.trim())[0]?.toUpperCase() ?? "?"

  return (
    <InputGroup>
      <InputGroupAddon align="inline-start">
        <Avatar className="size-5 rounded-sm after:rounded-sm">
          {user.avatar && (
            <AvatarImage alt={displayName} className="rounded-sm" src={user.avatar} />
          )}
          <AvatarFallback className="rounded-sm text-[10px]">{initial}</AvatarFallback>
        </Avatar>
      </InputGroupAddon>
      <InputGroupInput aria-label={t("taskDetail.field.creator")} disabled value={displayName} />
    </InputGroup>
  )
}

function createTaskEditForm(task: ProjectTask): TaskEditForm {
  return {
    assigneeUserId: task.assignee?.id ?? "",
    description: task.description,
    dueDate: task.dueDate ?? "",
    labels: [...task.labels],
    priority: task.priority,
    reminder: toReminderInput(task.reminder),
    startDate: task.startDate ?? "",
    status: task.status,
    title: task.title,
  }
}

function createFallbackProjectMember(task: ProjectTask): ClientProjectMember | null {
  if (!task.assignee) {
    return null
  }
  return {
    avatar: task.assignee.avatar,
    displayName: displayProjectUser(task.assignee),
    email: "",
    id: task.assignee.id,
    name: task.assignee.name,
    nickname: task.assignee.nickname,
    role: "member",
    sourceGroupIds: [],
    status: "active",
  }
}

function normalizeTaskEditForm(form: TaskEditForm): NormalizedTaskEditForm {
  return {
    assigneeUserId: form.assigneeUserId || null,
    description: form.description,
    dueDate: form.dueDate || null,
    labels: normalizeLabels(form.labels),
    priority: form.priority,
    reminder: normalizeReminderInput(form.reminder),
    startDate: form.startDate || null,
    status: form.status,
    title: form.title.trim(),
  }
}

function normalizeLabels(values: string[]) {
  const labels: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const label = value.trim()
    const key = label.toLocaleLowerCase()
    if (label && !seen.has(key)) {
      seen.add(key)
      labels.push(label)
    }
  }
  return labels
}

function getTaskEditValidationError(
  form: NormalizedTaskEditForm,
  t: ReturnType<typeof useLocale>["t"],
) {
  const titleLength = Array.from(form.title).length
  if (titleLength < 1 || titleLength > 240) {
    return t("taskDetail.validate.title")
  }
  if (form.startDate && form.dueDate && form.startDate > form.dueDate) {
    return t("taskDetail.validate.dateRange")
  }
  if (form.labels.length > 20) {
    return t("taskDetail.validate.labels")
  }
  if (form.labels.some((label) => Array.from(label).length > 32)) {
    return t("taskDetail.validate.labelLength")
  }
  return ""
}

function taskEditFormsEqual(left: NormalizedTaskEditForm, right: NormalizedTaskEditForm) {
  return (
    left.assigneeUserId === right.assigneeUserId &&
    left.description === right.description &&
    left.dueDate === right.dueDate &&
    left.priority === right.priority &&
    reminderInputsEqual(left.reminder, right.reminder) &&
    left.startDate === right.startDate &&
    left.status === right.status &&
    left.title === right.title &&
    left.labels.length === right.labels.length &&
    left.labels.every((label, index) => label === right.labels[index])
  )
}

function mergeTaskEditFields<T extends TaskEditForm | NormalizedTaskEditForm>(
  current: T,
  source: T,
  fields: Array<keyof TaskEditForm>,
): T {
  const values = Object.fromEntries(fields.map((field) => [field, source[field]]))
  return { ...current, ...values }
}

function toReminderInput(
  reminder: ProjectTask["reminder"] | undefined,
): ProjectTaskReminderInput | null {
  if (!reminder) {
    return null
  }
  if (reminder.mode === "once") {
    return {
      at: reminder.at,
      mode: "once",
      timezone: reminder.timezone,
    }
  }
  return normalizeReminderInput(reminder)
}

function normalizeReminderInput(
  reminder: ProjectTaskReminderInput | null,
): ProjectTaskReminderInput | null {
  if (!reminder) {
    return null
  }
  if (reminder.mode === "once") {
    return { at: reminder.at, mode: "once", timezone: reminder.timezone }
  }
  if (reminder.frequency === "weekly") {
    return {
      frequency: "weekly",
      mode: "recurring",
      time: reminder.time,
      timezone: reminder.timezone,
      weekdays: [...(reminder.weekdays ?? [])].sort((a, b) => a - b),
    }
  }
  if (reminder.frequency === "monthly") {
    return {
      dayOfMonth: reminder.dayOfMonth,
      frequency: "monthly",
      mode: "recurring",
      time: reminder.time,
      timezone: reminder.timezone,
    }
  }
  return {
    frequency: "daily",
    mode: "recurring",
    time: reminder.time,
    timezone: reminder.timezone,
  }
}

function reminderInputsEqual(
  left: ProjectTaskReminderInput | null,
  right: ProjectTaskReminderInput | null,
) {
  return (
    JSON.stringify(normalizeReminderInput(left)) === JSON.stringify(normalizeReminderInput(right))
  )
}

async function listAllProjectTaskLabels(projectId: string, excludedTaskId: string) {
  const labels = new Map<string, string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await listClientProjectTasks(projectId, {
      cursor,
      limit: 100,
    })
    for (const projectTask of page.tasks) {
      if (projectTask.id === excludedTaskId) {
        continue
      }
      for (const label of projectTask.labels) {
        const key = label.toLocaleLowerCase()
        if (!labels.has(key)) {
          labels.set(key, label)
        }
      }
    }
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      break
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)

  return Array.from(labels.values()).sort((left, right) => left.localeCompare(right, "zh-CN"))
}
