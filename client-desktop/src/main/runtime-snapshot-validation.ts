import type { RendererRuntimeSnapshot } from "@shared/bridge"

const refreshNames = new Set(["contacts", "conversations", "me", "projects"])
const pages = new Set<RendererRuntimeSnapshot["page"]>(["chat", "contacts", "init", "login", "projects", "setup", "unknown"])
const requestGroups = new Set([
  "api/client/apps",
  "api/client/auth",
  "api/client/contacts",
  "api/client/conversations",
  "api/client/info",
  "api/client/me",
  "api/client/projects",
  "api/client/temporary-files",
  "api/client/users",
  "api/client/ws",
])

export function parseRendererRuntimeSnapshot(value: unknown): RendererRuntimeSnapshot {
  const input = objectValue(value)
  const data = objectValue(input.data)
  const longTasks = objectValue(input.longTasks)
  const page = pages.has(input.page as RendererRuntimeSnapshot["page"])
    ? input.page as RendererRuntimeSnapshot["page"]
    : "unknown"
  return {
    activeRefreshes: boundedInteger(input.activeRefreshes, 100),
    activeRequests: boundedInteger(input.activeRequests, 1_000),
    data: {
      contacts: boundedInteger(data.contacts, 1_000_000),
      conversations: boundedInteger(data.conversations, 1_000_000),
      loadedConversations: boundedInteger(data.loadedConversations, 1_000_000),
      messages: boundedInteger(data.messages, 10_000_000),
      projects: boundedInteger(data.projects, 1_000_000),
    },
    eventLoopLagMs: boundedInteger(input.eventLoopLagMs, 600_000),
    ...(input.lastRefresh ? { lastRefresh: refreshSnapshot(input.lastRefresh) } : {}),
    ...(input.lastRequest ? { lastRequest: requestSnapshot(input.lastRequest) } : {}),
    longTasks: {
      count: boundedInteger(longTasks.count, 100_000),
      maxDurationMs: boundedInteger(longTasks.maxDurationMs, 600_000),
    },
    page,
  }
}

function refreshSnapshot(value: unknown): NonNullable<RendererRuntimeSnapshot["lastRefresh"]> {
  const input = objectValue(value)
  if (typeof input.name !== "string" || !refreshNames.has(input.name)) throw new Error("刷新诊断快照无效")
  return {
    ageMs: boundedInteger(input.ageMs, 86_400_000),
    durationMs: boundedInteger(input.durationMs, 600_000),
    name: input.name as NonNullable<RendererRuntimeSnapshot["lastRefresh"]>["name"],
  }
}

function requestSnapshot(value: unknown): NonNullable<RendererRuntimeSnapshot["lastRequest"]> {
  const input = objectValue(value)
  const method = typeof input.method === "string" && /^[A-Z]{1,8}$/.test(input.method) ? input.method : "UNKNOWN"
  const group = typeof input.group === "string" && requestGroups.has(input.group)
    ? input.group
    : "unknown"
  return {
    ageMs: boundedInteger(input.ageMs, 86_400_000),
    durationMs: boundedInteger(input.durationMs, 600_000),
    group,
    method,
    ...(input.status === undefined ? {} : { status: boundedInteger(input.status, 999) }),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("诊断快照字段无效")
  return value as Record<string, unknown>
}

function boundedInteger(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(0, Math.round(value)))
}
