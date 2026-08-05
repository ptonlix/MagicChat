import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { ChevronsDown, ChevronsUp, Equal } from "lucide-react"
import { toast } from "sonner"

import type { ProjectTaskPriority } from "@/components/projects/project-types"
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

function getPriorityOptions(t: ReturnType<typeof useLocale>["t"]): Array<{
  icon: React.ComponentType<{ className?: string }>
  iconClassName: string
  label: string
  value: ProjectTaskPriority
}> {
  return [
    {
      icon: ChevronsUp,
      iconClassName: "text-rose-600",
      label: t("project.priority.high"),
      value: 3,
    },
    {
      icon: Equal,
      iconClassName: "text-amber-600",
      label: t("project.priority.medium"),
      value: 2,
    },
    {
      icon: ChevronsDown,
      iconClassName: "text-muted-foreground",
      label: t("project.priority.low"),
      value: 1,
    },
  ]
}

export function UpdateProjectTaskPriorityDialog({
  currentPriority,
  onOpenChange,
  onUpdated,
  open,
  projectId,
  taskId,
}: {
  currentPriority: ProjectTaskPriority
  onOpenChange: (open: boolean) => void
  onUpdated: () => Promise<void>
  open: boolean
  projectId: string
  taskId: string
}) {
  const { t } = useLocale()

  const [priority, setPriority] = React.useState<ProjectTaskPriority>(currentPriority)
  const [saving, setSaving] = React.useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      setPriority(currentPriority)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || priority === currentPriority) {
      return
    }

    setSaving(true)
    try {
      await updateClientProjectTask(projectId, taskId, { priority })
      await onUpdated()
      onOpenChange(false)
      toast.success(t("updateTask.priority.saved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateTask.priority.failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5">
        <DialogHeader>
          <DialogTitle>{t("updateTask.priority.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("updateTask.priority.desc")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <RadioGroup
            disabled={saving}
            onValueChange={(value) => setPriority(Number(value) as ProjectTaskPriority)}
            value={String(priority)}
          >
            {getPriorityOptions(t).map((option) => {
              const Icon = option.icon
              const id = `task-priority-${taskId}-${option.value}`

              return (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                    priority === option.value && "border-foreground/30 bg-muted",
                  )}
                  htmlFor={id}
                  key={option.value}
                >
                  <RadioGroupItem id={id} value={String(option.value)} />
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
            <Button disabled={saving || priority === currentPriority} type="submit">
              {saving && <Spinner />}
              {t("updateTask.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
