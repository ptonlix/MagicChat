import { AudioLines, Mic, WandSparkles } from "lucide-react"
import { useLocale } from "@/components/locale-provider"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ConversationVoiceMenuProps = {
  disabled?: boolean
  onSendVoiceMessage: () => void
  onSmartVoiceInput: () => void
}

export function ConversationVoiceMenu({
  disabled = false,
  onSendVoiceMessage,
  onSmartVoiceInput,
}: ConversationVoiceMenuProps) {
  const { t } = useLocale()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("voiceMenu.aria")}
          disabled={disabled}
          size="icon"
          title={t("voiceMenu.aria")}
          type="button"
          variant="outline"
        >
          <Mic className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" side="top">
        <DropdownMenuItem onSelect={onSendVoiceMessage}>
          <AudioLines />
          {t("voiceMenu.sendVoice")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSmartVoiceInput}>
          <WandSparkles />
          {t("voiceMenu.smartInput")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
