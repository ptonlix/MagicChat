import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { AudioLines, ChevronDown, ChevronUp, LoaderCircle, Pause, Play } from "lucide-react"
import { toast } from "sonner"

import type { ClientVoiceMessageBody } from "@/lib/client-data-api"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

type MessageVoiceProps = {
  voice: ClientVoiceMessageBody
}

type ActiveVoicePlayback = {
  audio: HTMLAudioElement
  stop: () => void
}

let activeVoicePlayback: ActiveVoicePlayback | null = null
const playbackStartTimeoutMS = 15_000
type PlaybackState = "error" | "idle" | "loading" | "paused" | "playing"

export function MessageVoice({ voice }: MessageVoiceProps) {
  const { t } = useLocale()
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const objectURLRef = React.useRef<string | null>(null)
  const playbackAttemptRef = React.useRef(0)
  const playbackStateRef = React.useRef<PlaybackState>("idle")
  const reloadBeforePlayRef = React.useRef(false)
  const suppressMediaErrorRef = React.useRef(false)
  const timeoutRef = React.useRef<number | null>(null)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [playbackState, setPlaybackState] = React.useState<PlaybackState>("idle")
  const [transcriptExpanded, setTranscriptExpanded] = React.useState(false)
  const durationSeconds = voice.durationMS / 1_000
  const transcript = voice.transcript.trim()

  function updatePlaybackState(state: PlaybackState) {
    playbackStateRef.current = state
    setPlaybackState(state)
  }

  function clearPlaybackAttempt() {
    abortRef.current?.abort()
    abortRef.current = null
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }

  function releaseSource(audio: HTMLAudioElement | null) {
    if (audio && activeVoicePlayback?.audio === audio) activeVoicePlayback = null
    reloadBeforePlayRef.current = false
    audio?.pause()
    if (audio) {
      suppressMediaErrorRef.current = true
      audio.removeAttribute("src")
      audio.load()
    }
    if (objectURLRef.current) URL.revokeObjectURL(objectURLRef.current)
    objectURLRef.current = null
  }

  function failPlayback(message: string) {
    if (playbackStateRef.current === "error") return
    playbackAttemptRef.current += 1
    updatePlaybackState("error")
    clearPlaybackAttempt()
    releaseSource(audioRef.current)
    setCurrentTime(0)
    toast.error(message)
  }

  React.useEffect(
    () => () => {
      playbackAttemptRef.current += 1
      clearPlaybackAttempt()
      releaseSource(audioRef.current)
    },
    [],
  )

  function stopPlaybackAttempt(attemptId: number, audio: HTMLAudioElement) {
    if (playbackAttemptRef.current !== attemptId) return
    playbackAttemptRef.current += 1
    clearPlaybackAttempt()
    if (activeVoicePlayback?.audio === audio) activeVoicePlayback = null
    audio.pause()
    if (playbackStateRef.current !== "error") updatePlaybackState("paused")
  }

  async function handlePlayToggle() {
    const audio = audioRef.current
    if (!audio || playbackStateRef.current === "loading") return

    if (playbackStateRef.current === "playing") {
      if (activeVoicePlayback?.audio === audio) {
        activeVoicePlayback.stop()
      } else {
        stopPlaybackAttempt(playbackAttemptRef.current, audio)
      }
      return
    }

    clearPlaybackAttempt()
    if (playbackStateRef.current === "error") releaseSource(audio)
    updatePlaybackState("loading")
    const attemptId = playbackAttemptRef.current + 1
    playbackAttemptRef.current = attemptId
    const controller = new AbortController()
    abortRef.current = controller
    if (activeVoicePlayback && activeVoicePlayback.audio !== audio) activeVoicePlayback.stop()
    activeVoicePlayback = {
      audio,
      stop: () => stopPlaybackAttempt(attemptId, audio),
    }

    try {
      if (!audio.src) {
        const response = await fetch(
          `/api/client/temporary-files/${encodeURIComponent(voice.fileId)}/content`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        if (playbackAttemptRef.current !== attemptId) return
        objectURLRef.current = URL.createObjectURL(blob)
        suppressMediaErrorRef.current = false
        audio.src = objectURLRef.current
      }
      if (reloadBeforePlayRef.current) {
        // 部分 WebM/M4A 容器播放结束后不能可靠 seek 回开头，重新初始化解码器更稳定。
        audio.load()
        reloadBeforePlayRef.current = false
      }
      suppressMediaErrorRef.current = false
      await Promise.race([
        audio.play(),
        new Promise<never>((_resolve, reject) => {
          timeoutRef.current = window.setTimeout(
            () => reject(new Error("playback timeout")),
            playbackStartTimeoutMS,
          )
        }),
      ])
      if (playbackAttemptRef.current !== attemptId) return
      clearPlaybackAttempt()
      updatePlaybackState("playing")
    } catch (cause) {
      if (playbackAttemptRef.current !== attemptId) return
      if (cause instanceof DOMException && cause.name === "AbortError") {
        playbackAttemptRef.current += 1
        clearPlaybackAttempt()
        if (activeVoicePlayback?.audio === audio) activeVoicePlayback = null
        updatePlaybackState("paused")
        return
      }
      failPlayback(t("messageVoice.loadFailed"))
    }
  }

  function handleSeek(value: number[]) {
    const nextTime = value[0] ?? 0
    const audio = audioRef.current

    setCurrentTime(nextTime)
    if (audio) {
      audio.currentTime = nextTime
    }
  }

  return (
    <div className="grid w-80 max-w-full gap-2">
      <audio
        ref={audioRef}
        onEnded={() => {
          reloadBeforePlayRef.current = true
          playbackAttemptRef.current += 1
          clearPlaybackAttempt()
          if (activeVoicePlayback?.audio === audioRef.current) activeVoicePlayback = null
          setCurrentTime(0)
          updatePlaybackState("idle")
        }}
        onError={(event) => {
          if (
            suppressMediaErrorRef.current ||
            !objectURLRef.current ||
            !event.currentTarget.getAttribute("src")
          ) {
            return
          }
          failPlayback(t("messageVoice.playFailed"))
        }}
        onPause={() => {
          if (playbackStateRef.current === "playing") updatePlaybackState("paused")
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        preload="none"
      />
      <div className="flex min-h-10 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background/50 text-muted-foreground">
          <AudioLines className="size-5" />
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <Slider
            aria-label={t("messageVoice.progress")}
            disabled={playbackState === "error" || playbackState === "loading"}
            max={durationSeconds}
            min={0}
            onValueChange={handleSeek}
            step={0.01}
            value={[Math.min(currentTime, durationSeconds)]}
          />
          <div className="text-xs leading-snug text-muted-foreground tabular-nums">
            {playbackState === "error"
              ? t("messageVoice.playError")
              : t("messageVoice.seconds", { seconds: Math.max(1, Math.ceil(durationSeconds)) })}
          </div>
        </div>
        <Button
          aria-label={
            playbackState === "loading"
              ? t("messageVoice.loading")
              : playbackState === "playing"
                ? t("messageVoice.pause")
                : playbackState === "error"
                  ? t("messageVoice.retry")
                  : t("messageVoice.play")
          }
          className="hover:bg-background/70 data-[state=open]:bg-background/70 dark:hover:bg-background/70 dark:data-[state=open]:bg-background/70"
          disabled={playbackState === "loading"}
          onClick={() => void handlePlayToggle()}
          size="icon-sm"
          title={
            playbackState === "playing"
              ? t("messageVoice.pauseShort")
              : playbackState === "error"
                ? t("messageVoice.retryShort")
                : t("messageVoice.playShort")
          }
          type="button"
          variant="ghost"
        >
          {playbackState === "loading" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : playbackState === "playing" ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </Button>
      </div>
      {transcript && (
        <div className="border-t border-foreground/10 pt-2">
          <Button
            aria-expanded={transcriptExpanded}
            className="h-7 w-full justify-between px-1 text-xs"
            onClick={() => setTranscriptExpanded((expanded) => !expanded)}
            type="button"
            variant="ghost"
          >
            {t("messageVoice.transcript")}
            {transcriptExpanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
          {transcriptExpanded && (
            <p className="max-h-32 overflow-y-auto pt-1 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {transcript}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
