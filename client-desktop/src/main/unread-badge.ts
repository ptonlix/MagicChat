export function formatUnreadBadge(unreadCount: number): string {
  const normalized = Math.max(0, Math.trunc(unreadCount))
  if (normalized === 0) return ""
  return normalized > 99 ? "99+" : String(normalized)
}
