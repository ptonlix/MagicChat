import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { LoaderCircle, Mic, RotateCcw, Square } from "lucide-react"

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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useVoiceRecording } from "@/hooks/use-voice-recording"

type SmartVoiceInputDialogProps = {
  onAccept: (text: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function SmartVoiceInputDialog({
  onAccept,
  onOpenChange,
  open,
}: SmartVoiceInputDialogProps) {
  const { t } = useLocale()
  const [transcript, setTranscript] = React.useState("")
  const recording = useVoiceRecording()

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)

    if (!nextOpen) {
      setTranscript("")
      recording.resetRecording()
    }
  }

  function handleStartRecording() {
    setTranscript("")
    void recording.startRecording()
  }

  function handleAccept() {
    const normalizedTranscript = transcript.trim()

    if (!normalizedTranscript) {
      return
    }

    onAccept(normalizedTranscript)
    setTranscript("")
    recording.resetRecording()
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{t("smartVoice.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("smartVoice.desc")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <VoiceRecordingPanel
            elapsedSeconds={recording.elapsedSeconds}
            level={recording.level}
            status={recording.status}
          />
          {recording.error && <p className="text-sm text-destructive">{recording.error}</p>}
          <div className="flex justify-center">
            {recording.status === "idle" && (
              <Button onClick={handleStartRecording} type="button">
                <Mic />
                {t("smartVoice.start")}
              </Button>
            )}
            {recording.status === "requesting" && (
              <Button disabled type="button">
                <LoaderCircle className="animate-spin" />
                {t("smartVoice.connecting")}
              </Button>
            )}
            {recording.status === "processing" && (
              <Button disabled type="button">
                <LoaderCircle className="animate-spin" />
                {t("smartVoice.generating")}
              </Button>
            )}
            {recording.status === "recording" && (
              <Button onClick={recording.stopRecording} type="button" variant="destructive">
                <Square />
                {t("smartVoice.stop")}
              </Button>
            )}
            {recording.status === "recorded" && (
              <Button onClick={handleStartRecording} type="button" variant="outline">
                <RotateCcw />
                {t("smartVoice.retry")}
              </Button>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smart-voice-transcript">{t("smartVoice.transcript")}</Label>
            <Textarea
              id="smart-voice-transcript"
              className="max-h-64 min-h-36 resize-none"
              onChange={(event) => setTranscript(event.target.value)}
              placeholder={
                recording.status === "idle" ? t("smartVoice.hint") : t("smartVoice.waiting")
              }
              readOnly={recording.status === "idle"}
              value={transcript}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("smartVoice.cancel")}
            </Button>
          </DialogClose>
          <Button disabled={!transcript.trim()} onClick={handleAccept} type="button">
            {t("smartVoice.adopt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
