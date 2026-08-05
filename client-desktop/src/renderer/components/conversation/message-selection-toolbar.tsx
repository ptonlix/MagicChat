import { Forward, MessagesSquare, X } from "lucide-react"
import { useLocale } from "@/components/locale-provider"

import type { ConversationPanelForwardMode } from "@/lib/conversation-panel-types"
import { Button } from "@/components/ui/button"

export function MessageSelectionToolbar({
  onCancel,
  onForward,
  selectedCount,
}: {
  onCancel: () => void
  onForward: (mode: ConversationPanelForwardMode) => void
  selectedCount: number
}) {
  const { t } = useLocale()
  return (
    <div className="flex min-h-17 items-center justify-between gap-3 border-t bg-background px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          aria-label={t("selection.cancel")}
          onClick={onCancel}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("selection.count", { count: selectedCount })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          disabled={selectedCount === 0}
          onClick={() => onForward("separate")}
          type="button"
          variant="outline"
        >
          <Forward aria-hidden="true" />
          {t("selection.forwardOne")}
        </Button>
        <Button disabled={selectedCount < 2} onClick={() => onForward("merged")} type="button">
          <MessagesSquare aria-hidden="true" />
          {t("selection.forwardMerge")}
        </Button>
      </div>
    </div>
  )
}
