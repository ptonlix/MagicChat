import { normalizeShortcutAccelerator } from "@shared/shortcut-contract"

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
