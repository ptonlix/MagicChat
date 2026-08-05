import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { Circle, CircleCheckBig, CircleDot, CircleX } from "lucide-react"
import { toast } from "sonner"

import type { ProjectTaskStatus } from "@/components/projects/project-types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { updateClientProjectTask } from "@/lib/project-task-data-api"
import { cn } from "@/lib/utils"

function getStatusOptions(t: ReturnType<typeof useLocale>["t"]): Array<{
  icon: React.ComponentType<{ className?: string }>
  iconClassName: string
  label: string
  value: ProjectTaskStatus
}> {
  return [
    {
      icon: Circle,
      iconClassName: "text-amber-600",
      label: t("project.filter.todo"),
      value: "todo",
    },
    {
      icon: CircleDot,
      iconClassName: "text-sky-600",
      label: t("project.filter.in_progress"),
      value: "in_progress",
    },
    {
      icon: CircleCheckBig,
      iconClassName: "text-emerald-600",
      label: t("project.filter.done"),
      value: "done",
    },
    {
      icon: CircleX,
      iconClassName: "text-stone-400",
      label: t("project.filter.canceled"),
      value: "canceled",
    },
  ]
}

export function UpdateProjectTaskStatusDialog({
  currentStatus,
  onOpenChange,
  onUpdated,
  open,
  projectId,
  taskId,
}: {
  currentStatus: ProjectTaskStatus
  onOpenChange: (open: boolean) => void
  onUpdated: () => Promise<void>
  open: boolean
  projectId: string
  taskId: string
}) {
  const { t } = useLocale()

  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState(currentStatus)

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      setStatus(currentStatus)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || status === currentStatus) {
      return
    }

    setSaving(true)
    try {
      await updateClientProjectTask(projectId, taskId, { status })
      await onUpdated()
      onOpenChange(false)
      toast.success(t("updateTask.status.saved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateTask.status.failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5">
        <DialogHeader>
          <DialogTitle>{t("updateTask.status.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("updateTask.status.desc")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <RadioGroup
            disabled={saving}
            onValueChange={(value) => setStatus(value as ProjectTaskStatus)}
            value={status}
          >
            {getStatusOptions(t).map((option) => {
              const Icon = option.icon
              const id = `task-status-${taskId}-${option.value}`

              return (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                    status === option.value && "border-foreground/30 bg-muted",
                  )}
                  htmlFor={id}
                  key={option.value}
                >
                  <RadioGroupItem id={id} value={option.value} />
                  <Icon className={cn("size-4", option.iconClassName)} />
                  {option.label}
                </label>
              )
            })}
          </RadioGroup>
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("updateTask.cancel")}
            </Button>
            <Button disabled={saving || status === currentStatus} type="submit">
              {saving && <Spinner />}
              {t("updateTask.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
