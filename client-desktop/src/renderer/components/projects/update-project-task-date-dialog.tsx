import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { toast } from "sonner"

import { ProjectTaskDatePicker } from "@/components/projects/project-task-date-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { updateClientProjectTask } from "@/lib/project-task-data-api"

export function UpdateProjectTaskDateDialog({
  currentValue,
  dateType,
  onOpenChange,
  onUpdated,
  open,
  otherValue,
  projectId,
  taskId,
}: {
  currentValue: string | null
  dateType: "start" | "due"
  onOpenChange: (open: boolean) => void
  onUpdated: () => Promise<void>
  open: boolean
  otherValue: string | null
  projectId: string
  taskId: string
}) {
  const { t } = useLocale()

  const [saving, setSaving] = React.useState(false)
  const [value, setValue] = React.useState(currentValue ?? "")
  const fieldLabel =
    dateType === "start" ? t("taskDetail.field.startDate") : t("taskDetail.field.dueDate")

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      setValue(currentValue ?? "")
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || value === (currentValue ?? "")) {
      return
    }

    setSaving(true)
    try {
      await updateClientProjectTask(projectId, taskId, {
        ...(dateType === "start" ? { startDate: value || null } : { dueDate: value || null }),
      })
      await onUpdated()
      onOpenChange(false)
      toast.success(t("updateTask.date.saved", { label: fieldLabel }))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("updateTask.date.failed", { label: fieldLabel }),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("updateTask.date.title", { label: fieldLabel })}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("updateTask.date.desc", { label: fieldLabel })}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <ProjectTaskDatePicker
            disabled={saving}
            label={fieldLabel}
            maximum={dateType === "start" ? (otherValue ?? undefined) : undefined}
            minimum={dateType === "due" ? (otherValue ?? undefined) : undefined}
            onValueChange={setValue}
            value={value}
          />
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("updateTask.cancel")}
            </Button>
            <Button disabled={saving || value === (currentValue ?? "")} type="submit">
              {saving && <Spinner />}
              {t("updateTask.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
