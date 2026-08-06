import {
  normalizeSendMessageShortcutAccelerator,
  normalizeShortcutAccelerator,
} from "@shared/shortcut-contract"

export function acceleratorFromKeyboardEvent(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey">,
  platform: string,
): string | undefined {
  const key = shortcutKeyFromCode(event.code)
  if (!key) return undefined
  const modifiers: string[] = []
  if (event.metaKey) modifiers.push(platform === "darwin" ? "Command" : "Super")
  if (event.ctrlKey) modifiers.push("Control")
  if (event.altKey) modifiers.push("Alt")
  if (event.shiftKey) modifiers.push("Shift")
  if (modifiers.length === 0) return undefined
  try {
    return normalizeShortcutAccelerator([...modifiers, key].join("+"))
  } catch {
    return undefined
  }
}

/**
 * 判断键盘事件是否命中已配置的快捷键组合。
 * CommandOrControl 同时接受 Cmd（meta）或 Ctrl 按下。
 */
export function acceleratorMatchesKeyboardEvent(
  accelerator: string,
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey">,
): boolean {
  let tokens: string[]
  try {
    tokens = normalizeSendMessageShortcutAccelerator(accelerator).split("+")
  } catch {
    return false
  }
  const keyToken = tokens.at(-1)
  const modifiers = tokens.slice(0, -1)
  if (!keyToken || shortcutKeyFromCode(event.code) !== keyToken) return false

  if (modifiers.length === 0) {
    return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
  }

  const commandOrControl = modifiers.includes("CommandOrControl")
  const command = modifiers.includes("Command")
  const control = modifiers.includes("Control")
  const superKey = modifiers.includes("Super")
  const alt = modifiers.includes("Alt")
  const shift = modifiers.includes("Shift")

  const primaryPressed = commandOrControl
    ? event.metaKey || event.ctrlKey
    : command || superKey
      ? event.metaKey
      : control
        ? event.ctrlKey
        : false
  if (!primaryPressed) return false
  if (!commandOrControl && event.metaKey !== (command || superKey)) return false
  if (!commandOrControl && event.ctrlKey !== control) return false
  if (event.altKey !== alt) return false
  if (event.shiftKey !== shift) return false
  return true
}

function shortcutKeyFromCode(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return code
  const keys: Readonly<Record<string, string>> = {
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    Backspace: "Backspace",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Home: "Home",
    Insert: "Insert",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Space: "Space",
    Tab: "Tab",
  }
  return keys[code]
}
