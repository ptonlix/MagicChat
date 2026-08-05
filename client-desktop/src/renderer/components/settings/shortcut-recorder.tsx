import { RotateCcw, X } from "lucide-react"
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"

import { acceleratorFromKeyboardEvent } from "@/lib/shortcut-recorder"
import { DESKTOP_SETTINGS_CHANGED_EVENT } from "@/hooks/use-desktop-settings"
import {
  formatShortcutAccelerator,
  type ShortcutKind,
  type ShortcutState,
} from "@shared/shortcut-contract"

export function ShortcutRecorder({
  defaultAccelerator,
  kind,
  label,
  platform,
}: {
  defaultAccelerator: string
  kind: ShortcutKind
  label: string
  platform: string
}) {
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
        if (activeRef.current) setError("无法读取快捷键状态")
      },
    )
    return () => {
      activeRef.current = false
      if (beginPendingRef.current || recordingRef.current)
        void window.desktop.shortcuts.cancelRecording().catch(() => undefined)
    }
  }, [kind])

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
      if (activeRef.current) setError("暂时无法录制快捷键，请重试")
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
      setError("恢复原快捷键失败，请重新设置")
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
      if (result.status === "conflict") setError("该快捷键已被系统或其他应用占用")
      if (result.status === "save_failed") setError("快捷键保存失败，已恢复原设置")
      if (result.status === "restore_failed") {
        setError("快捷键设置失败，原快捷键也未能恢复，请重新设置")
      }
    } catch {
      recordingRef.current = false
      setError("快捷键设置失败，请重试")
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
      setError("请同时按下 Command、Control、Alt 或 Super 与一个按键")
      return
    }
    void updateShortcut(accelerator)
  }

  function keepRecordingFocus(event: ReactMouseEvent<HTMLButtonElement>) {
    if (recordingRef.current) event.preventDefault()
  }

  const labelText = state?.recording
    ? "请按下新的快捷键"
    : formatShortcutAccelerator(state?.accelerator ?? null, platform)
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
          aria-label={`恢复默认${label}`}
          className="settings-center-icon-button"
          disabled={pending || state?.accelerator === defaultAccelerator}
          onMouseDown={keepRecordingFocus}
          onClick={() => void updateShortcut(defaultAccelerator)}
          title="恢复默认"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={`禁用${label}`}
          className="settings-center-icon-button"
          disabled={pending || !state?.accelerator}
          onMouseDown={keepRecordingFocus}
          onClick={() => void updateShortcut(null)}
          title="禁用快捷键"
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>
      {(error || unavailable) && (
        <p className="shortcut-recorder-error" role="alert">
          {error || "当前快捷键未能注册，请设置其他组合"}
        </p>
      )}
    </div>
  )
}
