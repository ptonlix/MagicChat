export type DocumentPresenceUser = Readonly<{
  avatar: string
  color: string
  id: string
  name: string
}>

const colors = ["#0284c7", "#0d9488", "#7c3aed", "#ea580c", "#e11d48", "#4f46e5"]

export function documentPresenceColor(userId: string): string {
  let hash = 2166136261
  for (const character of userId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return colors[(hash >>> 0) % colors.length]
}

export function safePresenceColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#64748b"
}

export function normalizeDocumentPresenceUsers(
  states: readonly unknown[],
  currentUserId: string,
): DocumentPresenceUser[] {
  const users = new Map<string, DocumentPresenceUser>()
  for (const state of states) {
    if (!isRecord(state) || !isRecord(state.user)) continue
    const { avatar, color, id, name } = state.user
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) continue
    users.set(id, {
      avatar: typeof avatar === "string" ? avatar : "",
      color: safePresenceColor(color),
      id,
      name: name.trim(),
    })
  }
  return [...users.values()].sort((left, right) => {
    if (left.id === currentUserId) return -1
    if (right.id === currentUserId) return 1
    return left.name.localeCompare(right.name, "zh-CN")
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
