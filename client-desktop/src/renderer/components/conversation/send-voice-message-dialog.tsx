import { LoaderCircle, Mic, RotateCcw, Square } from "lucide-react"
import { useLocale } from "@/components/locale-provider"

import { VoiceRecordingPanel } from "@/components/conversation/conversation-voice-recorder"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useVoiceRecording } from "@/hooks/use-voice-recording"
import type { ClientMessage } from "@/lib/client-data-api"
import type { VoiceMessageRecording } from "@/lib/voice-message"

type SendVoiceMessageDialogProps = {
  conversationName: string
  onConfirm: (voice: VoiceMessageRecording) => Promise<ClientMessage | null>
  onOpenChange: (open: boolean) => void
  open: boolean
  sending: boolean
}

export function SendVoiceMessageDialog({
  conversationName,
  onConfirm,
  onOpenChange,
  open,
  sending,
}: SendVoiceMessageDialogProps) {
  const { t } = useLocale()
  const recording = useVoiceRecording()

  function handleOpenChange(nextOpen: boolean) {
    if (sending) {
      return
    }

    onOpenChange(nextOpen)

    if (!nextOpen) {
      recording.resetRecording()
    }
  }

  async function handleConfirm() {
    if (!recording.recording || recording.status !== "recorded" || sending) {
      return
    }

    const message = await onConfirm(recording.recording)
    if (message) {
      onOpenChange(false)
      recording.resetRecording()
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{t("sendVoice.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("sendVoice.desc")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <VoiceRecordingPanel
            elapsedSeconds={recording.elapsedSeconds}
            level={recording.level}
            status={recording.status}
          />
          {recording.error && <p className="text-sm text-destructive">{recording.error}</p>}
          <p className="min-w-0 text-sm text-muted-foreground">
            {t("voice.sendTo")}{" "}
            <span className="font-medium text-foreground">{conversationName}</span>
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={sending} type="button" variant="outline">
              {t("voice.cancel")}
            </Button>
          </DialogClose>
          {recording.status === "idle" && (
            <Button onClick={() => void recording.startRecording()} type="button">
              <Mic />
              {t("voice.start")}
            </Button>
          )}
          {recording.status === "requesting" && (
            <Button disabled type="button">
              <LoaderCircle className="animate-spin" />
              {t("voice.connecting")}
            </Button>
          )}
          {recording.status === "recording" && (
            <Button onClick={recording.stopRecording} type="button" variant="destructive">
              <Square />
              {t("voice.stop")}
            </Button>
          )}
          {recording.status === "processing" && (
            <Button disabled type="button">
              <LoaderCircle className="animate-spin" />
              {t("smartVoice.generating")}
            </Button>
          )}
          {recording.status === "recorded" && (
            <>
              <Button
                disabled={sending}
                onClick={() => void recording.startRecording()}
                type="button"
                variant="outline"
              >
                <RotateCcw />
                {t("voice.retry")}
              </Button>
              <Button
                disabled={!recording.recording || sending}
                onClick={() => void handleConfirm()}
                type="button"
              >
                {sending && <LoaderCircle className="animate-spin" />}
                {t("sendVoice.send")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
