import { RotateCcw, X } from "lucide-react"
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"

import { useLocale } from "@/components/locale-provider"
import { acceleratorFromKeyboardEvent } from "@/lib/shortcut-recorder"
import { DESKTOP_SETTINGS_CHANGED_EVENT } from "@/hooks/use-desktop-settings"
import type { TranslationKey } from "@/lib/i18n"
import {
  formatShortcutAccelerator,
  type ShortcutKind,
  type ShortcutState,
} from "@shared/shortcut-contract"

export function ShortcutRecorder({
  defaultAccelerator,
  kind,
  labelKey,
  platform,
}: {
  defaultAccelerator: string
  kind: ShortcutKind
  labelKey: TranslationKey
  platform: string
}) {
  const { t } = useLocale()
  const [state, setState] = useState<ShortcutState>()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const activeRef = useRef(true)
  const beginPendingRef = useRef(false)
  const recordingRef = useRef(false)

  useEffect(() => {
    activeRef.current = true
    void window.desktop.shortcuts.getState(kind).then(
      (nextState) => {
        if (activeRef.current) setState(nextState)
      },
      () => {
        if (activeRef.current) setError(t("settings.shortcuts.recording.beginError"))
      },
    )
    return () => {
      activeRef.current = false
      if (beginPendingRef.current || recordingRef.current)
        void window.desktop.shortcuts.cancelRecording().catch(() => undefined)
    }
  }, [kind, t])

  async function beginRecording() {
    if (pending || recordingRef.current) return
    setError("")
    setPending(true)
    beginPendingRef.current = true
    try {
      const nextState = await window.desktop.shortcuts.beginRecording(kind)
      beginPendingRef.current = false
      if (!activeRef.current) {
        void window.desktop.shortcuts.cancelRecording().catch(() => undefined)
        return
      }
      recordingRef.current = true
      setState(nextState)
    } catch {
      beginPendingRef.current = false
      if (activeRef.current) setError(t("settings.shortcuts.recording.beginError"))
    } finally {
      if (activeRef.current) setPending(false)
    }
  }

  async function cancelRecording() {
    if (!recordingRef.current) return
    recordingRef.current = false
    setPending(true)
    try {
      setState(await window.desktop.shortcuts.cancelRecording())
    } catch {
      setError(t("settings.shortcuts.recording.restoreError"))
      void refreshState()
    } finally {
      setPending(false)
    }
  }

  async function updateShortcut(accelerator: string | null) {
    setError("")
    setPending(true)
    try {
      const result = await window.desktop.shortcuts.set(kind, accelerator)
      recordingRef.current = false
      setState(result.state)
      if (result.status === "updated") {
        window.dispatchEvent(new Event(DESKTOP_SETTINGS_CHANGED_EVENT))
      }
      if (result.status === "conflict") setError(t("settings.shortcuts.error.conflict"))
      if (result.status === "save_failed") setError(t("settings.shortcuts.error.save"))
      if (result.status === "restore_failed") {
        setError(t("settings.shortcuts.error.restoreFailed"))
      }
    } catch {
      recordingRef.current = false
      setError(t("settings.shortcuts.error.retry"))
      await refreshState()
    } finally {
      setPending(false)
    }
  }

  async function refreshState() {
    try {
      setState(await window.desktop.shortcuts.getState(kind))
    } catch {
      // 保留当前可见状态，避免用未知值覆盖。
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!recordingRef.current) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === "Escape") {
      void cancelRecording()
      return
    }
    const accelerator = acceleratorFromKeyboardEvent(event.nativeEvent, platform)
    if (!accelerator) {
      setError(t("settings.shortcuts.recording.format"))
      return
    }
    void updateShortcut(accelerator)
  }

  function keepRecordingFocus(event: ReactMouseEvent<HTMLButtonElement>) {
    if (recordingRef.current) event.preventDefault()
  }

  const label = t(labelKey)
  const labelText = state?.recording
    ? t("settings.shortcuts.recording")
    : state?.accelerator
      ? formatShortcutAccelerator(state.accelerator, platform)
      : t("settings.shortcuts.unset")
  const unavailable =
    kind !== "sendMessage" &&
    Boolean(state?.accelerator) &&
    state?.registered === false &&
    !state.recording

  return (
    <div className="shortcut-recorder">
      <div className="shortcut-recorder-controls">
        <button
          aria-label={label}
          aria-pressed={state?.recording ?? false}
          className="shortcut-recorder-input"
          data-shortcut-recording={state?.recording ? "" : undefined}
          disabled={!state || pending}
          onBlur={() => void cancelRecording()}
          onClick={() => void beginRecording()}
          onKeyDown={handleKeyDown}
          type="button"
        >
          {labelText}
        </button>
        <button
          aria-label={t("settings.shortcuts.reset.aria", { label })}
          className="settings-center-icon-button"
          disabled={pending || state?.accelerator === defaultAccelerator}
          onMouseDown={keepRecordingFocus}
          onClick={() => void updateShortcut(defaultAccelerator)}
          title={t("settings.shortcuts.reset")}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={t("settings.shortcuts.disable.aria", { label })}
          className="settings-center-icon-button"
          disabled={pending || !state?.accelerator}
          onMouseDown={keepRecordingFocus}
          onClick={() => void updateShortcut(null)}
          title={t("settings.shortcuts.disable")}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>
      {(error || unavailable) && (
        <p className="shortcut-recorder-error" role="alert">
          {error || t("settings.shortcuts.unavailable")}
        </p>
      )}
    </div>
  )
}
