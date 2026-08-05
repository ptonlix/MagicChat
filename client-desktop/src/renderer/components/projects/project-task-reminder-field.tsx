import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { Bell, CalendarClock, Repeat2, X } from "lucide-react"

import {
  PROJECT_TASK_REMINDER_TIMEZONE,
  type ProjectTaskReminderInput,
  type ProjectTaskReminderState,
  type ProjectTaskStatus,
} from "@/components/projects/project-types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

function getWeekdays(t: ReturnType<typeof useLocale>["t"]) {
  const labels = Array.from(t("project.reminder.weekday"))
  return [
    { label: labels[0], value: 1 },
    { label: labels[1], value: 2 },
    { label: labels[2], value: 3 },
    { label: labels[3], value: 4 },
    { label: labels[4], value: 5 },
    { label: labels[5], value: 6 },
    { label: labels[6], value: 7 },
  ] as const
}

export function ProjectTaskReminderField({
  disabled = false,
  onValueChange,
  state,
  status,
  value,
}: {
  disabled?: boolean
  onValueChange: (value: ProjectTaskReminderInput | null) => void
  state?: ProjectTaskReminderState
  status: ProjectTaskStatus
  value: ProjectTaskReminderInput | null
}) {
  const { t } = useLocale()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<ProjectTaskReminderInput | null>(null)
  const paused = status === "done" || status === "canceled"

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraft(cloneReminderInput(value))
    }
    setOpen(nextOpen)
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={t("project.reminder.title")}
          className={cn(
            "w-full min-w-0 justify-start px-2.5 font-normal",
            !value && "text-muted-foreground",
          )}
          disabled={disabled}
          type="button"
          variant="outline"
        >
          <Bell />
          <span className="min-w-0 truncate">{formatReminderSummary(value, paused, state, t)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{t("project.reminder.title")}</p>
            <p className="text-xs text-muted-foreground">{t("project.reminder.desc")}</p>
          </div>
          {draft && (
            <Button
              aria-label={t("project.reminder.clear")}
              onClick={() => setDraft(null)}
              size="icon-xs"
              title={t("project.reminder.clear")}
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          )}
        </div>

        {!draft ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="h-auto gap-1.5 py-3 whitespace-nowrap"
              onClick={() => setDraft(createDefaultOnceReminder())}
              type="button"
              variant="outline"
            >
              <CalendarClock />
              {t("project.reminder.once")}
            </Button>
            <Button
              className="h-auto gap-1.5 py-3 whitespace-nowrap"
              onClick={() => setDraft(createDefaultRecurringReminder())}
              type="button"
              variant="outline"
            >
              <Repeat2 />
              {t("project.reminder.repeat")}
            </Button>
          </div>
        ) : (
          <>
            <ToggleGroup
              className="w-full"
              onValueChange={(mode) => {
                if (mode === "once") {
                  setDraft(createDefaultOnceReminder())
                } else if (mode === "recurring") {
                  setDraft(createDefaultRecurringReminder())
                }
              }}
              type="single"
              value={draft.mode}
              variant="outline"
            >
              <ToggleGroupItem className="flex-1" value="once">
                {t("project.reminder.once")}
              </ToggleGroupItem>
              <ToggleGroupItem className="flex-1" value="recurring">
                {t("project.reminder.repeat")}
              </ToggleGroupItem>
            </ToggleGroup>

            {draft.mode === "once" ? (
              <div className="grid gap-2">
                <Label htmlFor="task-reminder-once-at">{t("project.reminder.dateTime")}</Label>
                <Input
                  id="task-reminder-once-at"
                  min={minimumLocalDateTime()}
                  onChange={(event) => {
                    const at = shanghaiDateTimeToISO(event.target.value)
                    if (at) {
                      setDraft({ ...draft, at })
                    }
                  }}
                  step={60}
                  type="datetime-local"
                  value={isoToShanghaiDateTime(draft.at)}
                />
              </div>
            ) : (
              <RecurringReminderFields onValueChange={setDraft} value={draft} />
            )}

            <div className="text-xs text-muted-foreground">
              {t("project.reminder.timezone", { tz: PROJECT_TASK_REMINDER_TIMEZONE })}
              {paused && t("project.reminder.pausedHint")}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button onClick={() => setOpen(false)} type="button" variant="ghost">
            {t("project.reminder.cancel")}
          </Button>
          <Button
            onClick={() => {
              onValueChange(cloneReminderInput(draft))
              setOpen(false)
            }}
            type="button"
          >
            {t("project.reminder.confirm")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RecurringReminderFields({
  onValueChange,
  value,
}: {
  onValueChange: (value: ProjectTaskReminderInput) => void
  value: Extract<ProjectTaskReminderInput, { mode: "recurring" }>
}) {
  const { t } = useLocale()
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>{t("project.reminder.period")}</Label>
        <Select
          onValueChange={(frequency) => onValueChange(changeFrequency(value, frequency))}
          value={value.frequency}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">{t("project.reminder.daily")}</SelectItem>
            <SelectItem value="weekly">{t("project.reminder.weekly")}</SelectItem>
            <SelectItem value="monthly">{t("project.reminder.monthly")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.frequency === "weekly" && (
        <div className="grid gap-2">
          <Label>{t("project.reminder.weekdays")}</Label>
          <ToggleGroup
            className="w-full"
            onValueChange={(selected) => {
              if (selected.length > 0) {
                onValueChange({
                  ...value,
                  weekdays: selected.map(Number).sort((a, b) => a - b),
                })
              }
            }}
            spacing={1}
            type="multiple"
            value={(value.weekdays ?? []).map(String)}
            variant="outline"
          >
            {getWeekdays(t).map((weekday) => (
              <ToggleGroupItem
                aria-label={t("project.reminder.weekdayAria", { label: weekday.label })}
                className="min-w-0 flex-1 px-0"
                key={weekday.value}
                value={String(weekday.value)}
              >
                {weekday.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      {value.frequency === "monthly" && (
        <div className="grid gap-2">
          <Label>{t("project.reminder.monthDay")}</Label>
          <Select
            onValueChange={(day) => onValueChange({ ...value, dayOfMonth: Number(day) })}
            value={String(value.dayOfMonth ?? 1)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                <SelectItem key={day} value={String(day)}>
                  {t("project.reminder.daySuffix", { day })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="task-reminder-time">{t("project.reminder.time")}</Label>
        <Input
          id="task-reminder-time"
          onChange={(event) => {
            if (event.target.value) {
              onValueChange({ ...value, time: event.target.value })
            }
          }}
          step={60}
          type="time"
          value={value.time}
        />
      </div>
    </div>
  )
}

function changeFrequency(
  value: Extract<ProjectTaskReminderInput, { mode: "recurring" }>,
  frequency: string,
): Extract<ProjectTaskReminderInput, { mode: "recurring" }> {
  const base = {
    mode: "recurring" as const,
    time: value.time,
    timezone: PROJECT_TASK_REMINDER_TIMEZONE,
  }
  if (frequency === "weekly") {
    return { ...base, frequency, weekdays: [currentISOWeekday()] }
  }
  if (frequency === "monthly") {
    return {
      ...base,
      dayOfMonth: shanghaiDate(new Date()).getUTCDate(),
      frequency,
    }
  }
  return { ...base, frequency: "daily" }
}

function createDefaultOnceReminder(): ProjectTaskReminderInput {
  const at = new Date(Date.now() + 60 * 60 * 1000)
  at.setSeconds(0, 0)
  return {
    at: at.toISOString(),
    mode: "once",
    timezone: PROJECT_TASK_REMINDER_TIMEZONE,
  }
}

function createDefaultRecurringReminder(): ProjectTaskReminderInput {
  const at = shanghaiDate(new Date(Date.now() + 60 * 60 * 1000))
  return {
    frequency: "daily",
    mode: "recurring",
    time: `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`,
    timezone: PROJECT_TASK_REMINDER_TIMEZONE,
  }
}

function currentISOWeekday() {
  const weekday = shanghaiDate(new Date()).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

function formatReminderSummary(
  reminder: ProjectTaskReminderInput | null,
  paused: boolean,
  state: ProjectTaskReminderState | undefined,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (!reminder) {
    return t("project.reminder.none")
  }
  let summary: string
  if (reminder.mode === "once") {
    const at = new Date(reminder.at)
    summary = Number.isNaN(at.getTime())
      ? t("project.reminder.onceSummary")
      : new Intl.DateTimeFormat("zh-CN", {
          day: "numeric",
          hour: "2-digit",
          hour12: false,
          minute: "2-digit",
          month: "numeric",
          timeZone: PROJECT_TASK_REMINDER_TIMEZONE,
          year: "numeric",
        }).format(at)
  } else if (reminder.frequency === "daily") {
    summary = t("project.reminder.dailySummary", { time: reminder.time })
  } else if (reminder.frequency === "weekly") {
    const labels = (reminder.weekdays ?? [])
      .map((value) => getWeekdays(t).find((weekday) => weekday.value === value)?.label)
      .filter(Boolean)
      .join("、")
    summary = t("project.reminder.weeklySummary", { labels, time: reminder.time })
  } else {
    summary = t("project.reminder.monthlySummary", {
      day: reminder.dayOfMonth ?? "",
      time: reminder.time,
    })
  }
  if (paused || state === "paused") {
    return t("project.reminder.pausedSummary", { summary })
  }
  if (state === "fired") {
    return t("project.reminder.remindedSummary", { summary })
  }
  if (state === "expired") {
    return t("project.reminder.expiredSummary", { summary })
  }
  return summary
}

function isoToShanghaiDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return shanghaiDate(date).toISOString().slice(0, 16)
}

function shanghaiDateTimeToISO(value: string) {
  if (!value) {
    return null
  }
  const date = new Date(`${value}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function minimumLocalDateTime() {
  const date = new Date(Date.now() + 60_000)
  date.setSeconds(0, 0)
  return shanghaiDate(date).toISOString().slice(0, 16)
}

function shanghaiDate(date: Date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000)
}

function cloneReminderInput(
  value: ProjectTaskReminderInput | null,
): ProjectTaskReminderInput | null {
  if (!value) {
    return null
  }
  if (value.mode === "once") {
    return {
      at: value.at,
      mode: "once",
      timezone: PROJECT_TASK_REMINDER_TIMEZONE,
    }
  }
  return {
    ...value,
    timezone: PROJECT_TASK_REMINDER_TIMEZONE,
    weekdays: value.weekdays ? [...value.weekdays] : undefined,
  }
}
