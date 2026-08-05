import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { CalendarDays, X } from "lucide-react"

import { formatDateKey, parseDateKey } from "@/components/projects/project-task-view-utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function ProjectTaskDatePicker({
  disabled = false,
  label,
  maximum,
  minimum,
  onValueChange,
  value,
}: {
  disabled?: boolean
  label: string
  maximum?: string
  minimum?: string
  onValueChange: (value: string) => void
  value: string
}) {
  const { t } = useLocale()
  const [open, setOpen] = React.useState(false)
  const selectedDate = parseDateKey(value)
  const minimumDate = parseDateKey(minimum ?? null)
  const maximumDate = parseDateKey(maximum ?? null)

  return (
    <InputGroup>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label={label}
            className={cn(
              "h-full min-w-0 flex-1 cursor-pointer justify-start rounded-none border-0 bg-transparent px-2.5 text-left font-normal shadow-none hover:bg-transparent focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent",
              !selectedDate && "text-muted-foreground",
            )}
            data-slot="input-group-control"
            disabled={disabled}
            type="button"
            variant="ghost"
          >
            <CalendarDays />
            <span className="min-w-0 truncate">
              {selectedDate
                ? format(selectedDate, t("project.datePicker.format"), { locale: zhCN })
                : t("project.datePicker.select")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            autoFocus
            defaultMonth={selectedDate ?? undefined}
            disabled={(date) =>
              Boolean((minimumDate && date < minimumDate) || (maximumDate && date > maximumDate))
            }
            locale={zhCN}
            mode="single"
            onSelect={(date) => {
              if (!date) {
                return
              }
              onValueChange(formatDateKey(date))
              setOpen(false)
            }}
            selected={selectedDate ?? undefined}
          />
        </PopoverContent>
      </Popover>
      {selectedDate && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={t("project.datePicker.clear", { label })}
            className="cursor-pointer"
            disabled={disabled}
            onClick={() => onValueChange("")}
            size="icon-xs"
            title={t("project.datePicker.clear", { label })}
            type="button"
            variant="ghost"
          >
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
