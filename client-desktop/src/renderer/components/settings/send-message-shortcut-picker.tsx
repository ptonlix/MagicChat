import { useEffect, useState } from "react"

import { useLocale } from "@/components/locale-provider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DESKTOP_SETTINGS_CHANGED_EVENT } from "@/hooks/use-desktop-settings"
import {
  ALTERNATE_SEND_MESSAGE_SHORTCUT,
  DEFAULT_SEND_MESSAGE_SHORTCUT,
  formatShortcutAccelerator,
  type ShortcutState,
} from "@shared/shortcut-contract"

export function SendMessageShortcutPicker({ platform }: { platform: string }) {
  const { t } = useLocale()
  const [state, setState] = useState<ShortcutState>()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    void window.desktop.shortcuts.getState("sendMessage").then(
      async (nextState) => {
        if (!active) return
        if (
          nextState.accelerator !== null &&
          nextState.accelerator !== ALTERNATE_SEND_MESSAGE_SHORTCUT
        ) {
          try {
            const result = await window.desktop.shortcuts.set("sendMessage", null)
            if (!active) return
            setState(result.state)
            if (result.status === "updated") {
              window.dispatchEvent(new Event(DESKTOP_SETTINGS_CHANGED_EVENT))
              return
            }
          } catch {
            // 统一由下方稳定提示处理。
          }
          if (active) setError(t("settings.shortcuts.error.retry"))
          return
        }
        setState(nextState)
      },
      () => {
        if (active) setError(t("settings.shortcuts.recording.beginError"))
      },
    )
    return () => {
      active = false
    }
  }, [t])

  async function updateShortcut(value: string) {
    setError("")
    setPending(true)
    try {
      const accelerator = value === DEFAULT_SEND_MESSAGE_SHORTCUT ? null : value
      const result = await window.desktop.shortcuts.set("sendMessage", accelerator)
      setState(result.state)
      if (result.status === "updated") {
        window.dispatchEvent(new Event(DESKTOP_SETTINGS_CHANGED_EVENT))
      } else if (result.status === "save_failed") {
        setError(t("settings.shortcuts.error.save"))
      } else {
        setError(t("settings.shortcuts.error.retry"))
      }
    } catch {
      setError(t("settings.shortcuts.error.retry"))
    } finally {
      setPending(false)
    }
  }

  function presetLabel(sendAccelerator: string) {
    const newlineAccelerator =
      sendAccelerator === DEFAULT_SEND_MESSAGE_SHORTCUT
        ? ALTERNATE_SEND_MESSAGE_SHORTCUT
        : DEFAULT_SEND_MESSAGE_SHORTCUT
    return t("settings.shortcuts.sendMessage.preset", {
      newline: formatShortcutAccelerator(newlineAccelerator, platform),
      send: formatShortcutAccelerator(sendAccelerator, platform),
    })
  }

  const selectedValue =
    state?.accelerator === ALTERNATE_SEND_MESSAGE_SHORTCUT
      ? ALTERNATE_SEND_MESSAGE_SHORTCUT
      : DEFAULT_SEND_MESSAGE_SHORTCUT

  return (
    <div className="shortcut-recorder send-message-shortcut-picker">
      <Select
        disabled={!state || pending}
        onValueChange={(value) => void updateShortcut(value)}
        value={selectedValue}
      >
        <SelectTrigger
          aria-label={t("settings.shortcuts.sendMessage.aria")}
          className="send-message-shortcut-select"
        >
          <SelectValue>{presetLabel(selectedValue)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="send-message-shortcut-menu" position="popper">
          <SelectItem value={DEFAULT_SEND_MESSAGE_SHORTCUT}>
            {presetLabel(DEFAULT_SEND_MESSAGE_SHORTCUT)}
          </SelectItem>
          <SelectItem value={ALTERNATE_SEND_MESSAGE_SHORTCUT}>
            {presetLabel(ALTERNATE_SEND_MESSAGE_SHORTCUT)}
          </SelectItem>
        </SelectContent>
      </Select>
      {error ? (
        <p className="shortcut-recorder-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
