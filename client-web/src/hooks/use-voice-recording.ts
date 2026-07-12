import * as React from "react"

import {
  voiceMessageAudioBitsPerSecond,
  voiceMessageContentType,
  voiceMessageMaxBytes,
  voiceMessageMaxDurationMS,
  type VoiceMessageRecording,
} from "@/lib/voice-message"

export type VoiceRecordingStatus =
  "idle" | "requesting" | "recording" | "processing" | "recorded"

const analyserFFTSize = 256
const waveformUpdateIntervalMS = 50

export function useVoiceRecording() {
  const analyserRef = React.useRef<AnalyserNode | null>(null)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const animationFrameRef = React.useRef<number | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const lastWaveformUpdateRef = React.useRef(0)
  const maxDurationTimeoutRef = React.useRef<number | null>(null)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const recordingStartedAtRef = React.useRef(0)
  const requestVersionRef = React.useRef(0)
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0)
  const [error, setError] = React.useState("")
  const [level, setLevel] = React.useState(0)
  const [recording, setRecording] =
    React.useState<VoiceMessageRecording | null>(null)
  const [status, setStatus] = React.useState<VoiceRecordingStatus>("idle")

  const clearMaxDurationTimeout = React.useCallback(() => {
    if (maxDurationTimeoutRef.current !== null) {
      window.clearTimeout(maxDurationTimeoutRef.current)
      maxDurationTimeoutRef.current = null
    }
  }, [])

  const releaseMicrophone = React.useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())

    if (audioContextRef.current) {
      void audioContextRef.current.close()
    }

    sourceRef.current = null
    analyserRef.current = null
    streamRef.current = null
    audioContextRef.current = null
  }, [])

  const discardMediaRecorder = React.useCallback(() => {
    const recorder = mediaRecorderRef.current
    mediaRecorderRef.current = null
    chunksRef.current = []

    if (!recorder) {
      return
    }

    recorder.ondataavailable = null
    recorder.onerror = null
    recorder.onstop = null

    if (recorder.state !== "inactive") {
      recorder.stop()
    }
  }, [])

  const finishRecording = React.useCallback(() => {
    clearMaxDurationTimeout()

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === "inactive") {
      return
    }

    setStatus("processing")
    recorder.stop()
  }, [clearMaxDurationTimeout])

  React.useEffect(() => {
    if (status !== "recording") {
      return
    }

    const interval = window.setInterval(() => {
      const audioTime = audioContextRef.current?.currentTime ?? 0
      const elapsedMS = (audioTime - recordingStartedAtRef.current) * 1_000
      setElapsedSeconds(
        Math.min(60, Math.max(0, Math.floor(elapsedMS / 1_000)))
      )
    }, 250)

    return () => {
      window.clearInterval(interval)
    }
  }, [status])

  React.useEffect(
    () => () => {
      requestVersionRef.current += 1
      clearMaxDurationTimeout()
      discardMediaRecorder()
      releaseMicrophone()
    },
    [clearMaxDurationTimeout, discardMediaRecorder, releaseMicrophone]
  )

  async function startRecording() {
    if (
      status === "requesting" ||
      status === "recording" ||
      status === "processing"
    ) {
      return
    }

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    clearMaxDurationTimeout()
    discardMediaRecorder()
    releaseMicrophone()
    setElapsedSeconds(0)
    setError("")
    setLevel(0)
    setRecording(null)
    setStatus("requesting")

    if (!window.isSecureContext) {
      setError("麦克风只能在 HTTPS 或 localhost 下使用")
      setStatus("idle")
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持麦克风访问")
      setStatus("idle")
      return
    }
    if (
      typeof MediaRecorder === "undefined" ||
      !MediaRecorder.isTypeSupported(voiceMessageContentType)
    ) {
      setError("当前浏览器不支持 WebM/Opus 录音")
      setStatus("idle")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      if (requestVersionRef.current !== requestVersion) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)
      const recorder = new MediaRecorder(stream, {
        audioBitsPerSecond: voiceMessageAudioBitsPerSecond,
        mimeType: voiceMessageContentType,
      })

      analyser.fftSize = analyserFFTSize
      analyser.smoothingTimeConstant = 0.72
      source.connect(analyser)

      streamRef.current = stream
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      sourceRef.current = source
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onerror = () => {
        if (requestVersionRef.current !== requestVersion) {
          return
        }

        requestVersionRef.current += 1
        clearMaxDurationTimeout()
        discardMediaRecorder()
        releaseMicrophone()
        setError("录音失败，请重新尝试")
        setLevel(0)
        setStatus("idle")
      }
      recorder.onstop = () => {
        const durationMS = Math.min(
          voiceMessageMaxDurationMS,
          Math.max(
            1,
            Math.round(
              (audioContext.currentTime - recordingStartedAtRef.current) * 1_000
            )
          )
        )
        const blob = new Blob(chunksRef.current, {
          type: voiceMessageContentType,
        })

        mediaRecorderRef.current = null
        chunksRef.current = []
        releaseMicrophone()

        if (requestVersionRef.current !== requestVersion) {
          return
        }
        if (blob.size <= 0) {
          setError("没有录制到有效的语音内容")
          setStatus("idle")
          return
        }
        if (blob.size > voiceMessageMaxBytes) {
          setError("语音文件超过 1MiB，请重新录制")
          setStatus("idle")
          return
        }

        setElapsedSeconds(Math.ceil(durationMS / 1_000))
        setLevel(0)
        setRecording({ blob, durationMS })
        setStatus("recorded")
      }

      if (audioContext.state === "suspended") {
        await audioContext.resume()
      }
      if (requestVersionRef.current !== requestVersion) {
        discardMediaRecorder()
        releaseMicrophone()
        return
      }

      recordingStartedAtRef.current = audioContext.currentTime
      recorder.start(250)
      setStatus("recording")
      monitorMicrophoneLevel(analyser)
      maxDurationTimeoutRef.current = window.setTimeout(
        finishRecording,
        voiceMessageMaxDurationMS
      )
    } catch (caughtError) {
      if (requestVersionRef.current !== requestVersion) {
        return
      }

      clearMaxDurationTimeout()
      discardMediaRecorder()
      releaseMicrophone()
      setError(getMicrophoneErrorMessage(caughtError))
      setStatus("idle")
    }
  }

  function monitorMicrophoneLevel(analyser: AnalyserNode) {
    const samples = new Uint8Array(analyser.fftSize)

    function update(timestamp: number) {
      if (analyserRef.current !== analyser) {
        return
      }

      if (
        timestamp - lastWaveformUpdateRef.current >=
        waveformUpdateIntervalMS
      ) {
        analyser.getByteTimeDomainData(samples)
        let sumOfSquares = 0

        for (const sample of samples) {
          const normalizedSample = (sample - 128) / 128
          sumOfSquares += normalizedSample * normalizedSample
        }

        const rootMeanSquare = Math.sqrt(sumOfSquares / samples.length)
        setLevel(Math.min(1, Math.max(0, rootMeanSquare * 8)))
        lastWaveformUpdateRef.current = timestamp
      }

      animationFrameRef.current = window.requestAnimationFrame(update)
    }

    animationFrameRef.current = window.requestAnimationFrame(update)
  }

  function resetRecording() {
    requestVersionRef.current += 1
    clearMaxDurationTimeout()
    discardMediaRecorder()
    releaseMicrophone()
    setElapsedSeconds(0)
    setError("")
    setLevel(0)
    setRecording(null)
    setStatus("idle")
  }

  return {
    elapsedSeconds,
    error,
    level,
    recording,
    resetRecording,
    startRecording,
    status,
    stopRecording: finishRecording,
  }
}

function getMicrophoneErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return "无法访问麦克风，请稍后重试"
  }

  switch (error.name) {
    case "NotAllowedError":
      return "未获得麦克风权限，请在浏览器设置中允许访问"
    case "NotFoundError":
      return "没有检测到可用的麦克风"
    case "NotReadableError":
      return "麦克风暂时不可用，可能正在被其他应用占用"
    default:
      return "无法访问麦克风，请稍后重试"
  }
}
