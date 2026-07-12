import { AudioLines, Mic, WandSparkles } from "lucide-react"

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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="语音"
          disabled={disabled}
          size="icon"
          title="语音"
          type="button"
          variant="outline"
        >
          <Mic className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" side="top">
        <DropdownMenuItem onSelect={onSendVoiceMessage}>
          <AudioLines />
          发送语音消息
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSmartVoiceInput}>
          <WandSparkles />
          智能语音输入
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
