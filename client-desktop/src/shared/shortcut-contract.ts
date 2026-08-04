export const DEFAULT_SCREENSHOT_SHORTCUT = "CommandOrControl+Shift+A"

export type ScreenshotShortcutState = Readonly<{
  accelerator: string | null
  recording: boolean
  registered: boolean
}>

export type ScreenshotShortcutUpdateResult = Readonly<{
  state: ScreenshotShortcutState
  status: "conflict" | "restore_failed" | "save_failed" | "updated"
}>

export interface ShortcutBridge {
  beginRecording(): Promise<ScreenshotShortcutState>
  cancelRecording(): Promise<ScreenshotShortcutState>
  getState(): Promise<ScreenshotShortcutState>
  setScreenshot(accelerator: string | null): Promise<ScreenshotShortcutUpdateResult>
}

const MODIFIER_ORDER = ["CommandOrControl", "Command", "Control", "Super", "Alt", "Shift"] as const

const MODIFIERS = new Set<string>(MODIFIER_ORDER)
const PRIMARY_MODIFIERS = new Set<string>(MODIFIER_ORDER.slice(0, -1))
const NAMED_KEYS = new Set([
  "Backspace",
  "Delete",
  "Down",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Insert",
  "Left",
  "PageDown",
  "PageUp",
  "Right",
  "Space",
  "Tab",
  "Up",
])

export function normalizeShortcutAccelerator(value: unknown): string {
  if (typeof value !== "string" || value.length < 3 || value.length > 96) {
    throw new Error("快捷键格式无效")
  }
  const tokens = value.split("+")
  if (tokens.some((token) => !token || token.trim() !== token)) {
    throw new Error("快捷键格式无效")
  }
  const key = tokens.at(-1)
  const modifiers = tokens.slice(0, -1)
  if (!key || !isShortcutKey(key) || modifiers.length === 0) {
    throw new Error("快捷键格式无效")
  }
  if (
    new Set(modifiers).size !== modifiers.length ||
    modifiers.some((item) => !MODIFIERS.has(item))
  ) {
    throw new Error("快捷键修饰键无效")
  }
  if (!modifiers.some((item) => PRIMARY_MODIFIERS.has(item))) {
    throw new Error("快捷键至少需要 Command、Control、Alt 或 Super 修饰键")
  }
  if (
    modifiers.filter((item) => ["CommandOrControl", "Command", "Control"].includes(item)).length > 1
  ) {
    throw new Error("快捷键修饰键冲突")
  }
  const orderedModifiers = MODIFIER_ORDER.filter((item) => modifiers.includes(item))
  return [...orderedModifiers, normalizeShortcutKey(key)].join("+")
}

export function formatShortcutAccelerator(accelerator: string | null, platform: string): string {
  if (!accelerator) return "未设置"
  const tokens = normalizeShortcutAccelerator(accelerator).split("+")
  const isMac = platform === "darwin"
  return tokens
    .map((token) => {
      if (token === "CommandOrControl") return isMac ? "⌘" : "Ctrl"
      if (token === "Command") return isMac ? "⌘" : "Command"
      if (token === "Control") return isMac ? "⌃" : "Ctrl"
      if (token === "Super") return isMac ? "⌘" : "Super"
      if (token === "Alt") return isMac ? "⌥" : "Alt"
      if (token === "Shift") return isMac ? "⇧" : "Shift"
      return displayShortcutKey(token)
    })
    .join(isMac ? "" : " + ")
}

function isShortcutKey(value: string): boolean {
  return /^[A-Z0-9]$/i.test(value) || /^F(?:[1-9]|1\d|2[0-4])$/.test(value) || NAMED_KEYS.has(value)
}

function normalizeShortcutKey(value: string): string {
  return /^[a-z]$/i.test(value) ? value.toUpperCase() : value
}

function displayShortcutKey(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    Down: "↓",
    Left: "←",
    Right: "→",
    Space: "Space",
    Up: "↑",
  }
  return labels[value] ?? value
}
