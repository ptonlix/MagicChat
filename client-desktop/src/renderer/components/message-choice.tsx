import * as React from "react"

import type { ClientChoiceMessageBody, ClientChoiceState } from "@/lib/client-data-api"
import { formatMentionTemplateText, type MentionLabelResolver } from "@/lib/message-mentions"
import { cn } from "@/lib/utils"
import { MessageMarkdown } from "@/components/message-markdown"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export function MessageChoice({
  body,
  choice,
  currentUserId,
  mentionLabelResolver,
  messageId,
  onRespond,
  showResponseCounts = false,
}: {
  body: ClientChoiceMessageBody
  choice?: ClientChoiceState
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  messageId?: string
  onRespond?: (optionIds: string[]) => Promise<void>
  showResponseCounts?: boolean
}) {
  const hasResponded = Boolean(choice?.myOptionIds.length)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)
  const voted = hasResponded || submitted
  const activeIds = voted ? (choice?.myOptionIds ?? selectedIds) : selectedIds
  const counts = new Map(choice?.options.map((option) => [option.id, option.responseCount]) ?? [])

  async function submit() {
    if (!onRespond || voted || activeIds.length === 0) return
    setSubmitting(true)
    try {
      await onRespond(activeIds)
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  function toggleOption(optionId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...current, optionId] : current.filter((selectedId) => selectedId !== optionId),
    )
  }

  return (
    <div className="w-120 max-w-full" data-slot="choice-message">
      <div className="mb-3">
        {body.contentType === "markdown" ? (
          <MessageMarkdown
            content={body.content}
            currentUserId={currentUserId}
            mentionLabelResolver={mentionLabelResolver}
          />
        ) : (
          <p>{formatMentionTemplateText(body.content, mentionLabelResolver)}</p>
        )}
      </div>
      {body.selection === "single" ? (
        <RadioGroup
          className="gap-2"
          disabled={!onRespond || voted || submitting}
          onValueChange={(value) => setSelectedIds([value])}
          value={activeIds[0] ?? ""}
        >
          {body.options.map((option) => (
            <ChoiceOption
              key={option.id}
              control={
                <RadioGroupItem
                  aria-label={option.label}
                  id={`${messageId ?? "choice"}-${option.id}`}
                  value={option.id}
                />
              }
              count={counts.get(option.id) ?? 0}
              htmlFor={`${messageId ?? "choice"}-${option.id}`}
              label={option.label}
              selected={activeIds.includes(option.id)}
              showResponseCount={showResponseCounts}
            />
          ))}
        </RadioGroup>
      ) : (
        <div className="grid gap-2">
          {body.options.map((option) => (
            <ChoiceOption
              key={option.id}
              control={
                <Checkbox
                  aria-label={option.label}
                  checked={activeIds.includes(option.id)}
                  disabled={!onRespond || voted || submitting}
                  id={`${messageId ?? "choice"}-${option.id}`}
                  onCheckedChange={(checked) => toggleOption(option.id, checked === true)}
                />
              }
              count={counts.get(option.id) ?? 0}
              htmlFor={`${messageId ?? "choice"}-${option.id}`}
              label={option.label}
              selected={activeIds.includes(option.id)}
              showResponseCount={showResponseCounts}
            />
          ))}
        </div>
      )}
      {voted ? (
        <div className="mt-3 border-t border-foreground/10 pt-3">
          <Button className="w-full" disabled size="sm" type="button" variant="outline">
            已投票
          </Button>
        </div>
      ) : (
        <div className="mt-3 border-t border-foreground/10 pt-3">
          <Button
            className="w-full"
            disabled={!onRespond || submitting || activeIds.length === 0}
            onClick={() => void submit()}
            size="sm"
            type="button"
            variant="outline"
          >
            {submitting ? "提交中..." : "提交"}
          </Button>
        </div>
      )}
    </div>
  )
}

function ChoiceOption({
  control,
  count,
  htmlFor,
  label,
  selected,
  showResponseCount,
}: {
  control: React.ReactNode
  count: number
  htmlFor: string
  label: string
  selected: boolean
  showResponseCount: boolean
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border border-foreground/10 px-3 py-2 transition-colors",
        selected && "border-teal-500/50 bg-teal-500/10",
      )}
      htmlFor={htmlFor}
    >
      {control}
      <span className="min-w-0 flex-1 wrap-break-word">{label}</span>
      {showResponseCount && (
        <span className="shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-xs tabular-nums">
          {count}
        </span>
      )}
    </label>
  )
}
