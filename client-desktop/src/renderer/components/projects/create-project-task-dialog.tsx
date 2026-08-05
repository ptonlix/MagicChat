import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { ChevronsDown, ChevronsUp, Equal } from "lucide-react"
import { toast } from "sonner"

import { ProjectMemberCombobox } from "@/components/projects/project-member-combobox"
import { ProjectTaskReminderField } from "@/components/projects/project-task-reminder-field"
import type {
  ProjectTaskPriority,
  ProjectTaskReminderInput,
} from "@/components/projects/project-types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import type { ClientProjectMember } from "@/lib/project-data-api"
import { listAllClientProjectMembers } from "@/lib/project-members"
import { createClientProjectTask } from "@/lib/project-task-data-api"

export function CreateProjectTaskDialog({
  onCreated,
  onOpenChange,
  open,
  projectId,
}: {
  onCreated: () => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  projectId: string
}) {
  const { t } = useLocale()
  const [assigneeUserId, setAssigneeUserId] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [members, setMembers] = React.useState<ClientProjectMember[]>([])
  const [membersError, setMembersError] = React.useState("")
  const [membersLoading, setMembersLoading] = React.useState(true)
  const [priority, setPriority] = React.useState<ProjectTaskPriority>(2)
  const [reminder, setReminder] = React.useState<ProjectTaskReminderInput | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const assigneeComboboxPortal = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    void listAllClientProjectMembers(projectId)
      .then((nextMembers) => {
        if (active) {
          setMembers(nextMembers.filter((member) => member.status === "active"))
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMembersError(error instanceof Error ? error.message : t("project.members.loadFailed"))
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
  }, [open, projectId, t])

  const selectedAssignee = members.find((member) => member.id === assigneeUserId)
  const trimmedTitle = title.trim()
  const canSubmit = !saving && trimmedTitle.length > 0

  function resetForm() {
    setAssigneeUserId("")
    setDescription("")
    setMembers([])
    setMembersError("")
    setMembersLoading(true)
    setPriority(2)
    setReminder(null)
    setSaving(false)
    setTitle("")
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      resetForm()
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    setSaving(true)
    try {
      await createClientProjectTask(projectId, {
        assigneeUserId: assigneeUserId || null,
        description,
        priority,
        reminder,
        title: trimmedTitle,
      })
      await onCreated()
      resetForm()
      onOpenChange(false)
      toast.success(t("project.task.create.success"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("project.task.create.failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("project.task.create.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("project.task.create.desc")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="create-task-title">{t("project.task.title")}</Label>
            <Input
              autoFocus
              disabled={saving}
              id="create-task-title"
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("project.task.titlePlaceholder")}
              value={title}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-task-description">{t("project.task.description")}</Label>
            <Textarea
              className="min-h-40"
              disabled={saving}
              id="create-task-description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("project.task.descriptionPlaceholder")}
              value={description}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TaskSelectField label={t("project.task.priorityLabel")}>
              <Select
                disabled={saving}
                onValueChange={(value) => setPriority(Number(value) as ProjectTaskPriority)}
                value={String(priority)}
              >
                <SelectTrigger aria-label={t("project.task.priorityLabel")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">
                    <ChevronsDown className="text-muted-foreground" />
                    {t("project.priority.low")}
                  </SelectItem>
                  <SelectItem value="2">
                    <Equal className="text-amber-600" />
                    {t("project.priority.medium")}
                  </SelectItem>
                  <SelectItem value="3">
                    <ChevronsUp className="text-rose-600" />
                    {t("project.priority.high")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </TaskSelectField>

            <TaskSelectField label={t("project.task.assigneeLabel")}>
              <ProjectMemberCombobox
                disabled={saving || membersLoading}
                loading={membersLoading}
                members={members}
                onValueChange={(member: ClientProjectMember | null) =>
                  setAssigneeUserId(member?.id ?? "")
                }
                portalContainer={assigneeComboboxPortal}
                value={selectedAssignee ?? null}
              />
              {membersError && <p className="text-xs text-destructive">{membersError}</p>}
            </TaskSelectField>
          </div>

          <TaskSelectField label={t("project.task.reminderLabel")}>
            <ProjectTaskReminderField
              disabled={saving}
              onValueChange={setReminder}
              status="todo"
              value={reminder}
            />
          </TaskSelectField>

          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("project.cancel")}
            </Button>
            <Button disabled={!canSubmit} type="submit">
              {saving && <Spinner />}
              {t("project.createTask")}
            </Button>
          </DialogFooter>
        </form>
        <div className="absolute top-0 left-0 size-0" ref={assigneeComboboxPortal} />
      </DialogContent>
    </Dialog>
  )
}

function TaskSelectField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
