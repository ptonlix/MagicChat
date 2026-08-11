import type { RendererRuntimeSnapshot } from "@shared/bridge"
import { recordRendererDiagnostic } from "@/lib/desktop-diagnostics"

type RefreshName = NonNullable<RendererRuntimeSnapshot["lastRefresh"]>["name"]
type RefreshMetric = Omit<NonNullable<RendererRuntimeSnapshot["lastRefresh"]>, "ageMs"> & {
  completedAt: number
}
type RequestMetric = Omit<NonNullable<RendererRuntimeSnapshot["lastRequest"]>, "ageMs"> & {
  completedAt: number
}

const data = { contacts: 0, conversations: 0, loadedConversations: 0, messages: 0, projects: 0 }
let activeRefreshes = 0
let activeRequests = 0
let lastRefresh: RefreshMetric | undefined
let lastRequest: RequestMetric | undefined
let longTaskCount = 0
let maxLongTaskMs = 0
let maxEventLoopLagMs = 0
let lastActivatedAt = performance.now()

export function startRuntimeDiagnostics(intervalMs = 1_000): () => void {
  let expectedAt = performance.now() + intervalMs
  const timer = window.setInterval(() => {
    const now = performance.now()
    maxEventLoopLagMs = Math.max(maxEventLoopLagMs, now - expectedAt)
    expectedAt = now + intervalMs
    window.desktop.diagnostics.reportRuntime(snapshot())
    longTaskCount = 0
    maxLongTaskMs = 0
    maxEventLoopLagMs = 0
  }, intervalMs)

  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount += 1
        maxLongTaskMs = Math.max(maxLongTaskMs, entry.duration)
      }
    })
    observer.observe({ entryTypes: ["longtask"] })
  } catch {
    // 部分运行环境不支持 Long Tasks API，心跳仍可提供事件循环延迟。
  }

  const reportWindowState = () => {
    if (document.hasFocus()) lastActivatedAt = performance.now()
    void recordRendererDiagnostic("environment.window-state-changed", undefined, {
      documentVisibility: document.visibilityState === "visible" ? "visible" : "hidden",
      windowFocused: document.hasFocus(),
      windowMinimized: document.visibilityState !== "visible",
      windowVisible: document.visibilityState === "visible",
    })
  }
  const reportNetworkState = () => {
    void recordRendererDiagnostic("environment.network-changed", undefined, {
      navigatorOnline: navigator.onLine,
    })
  }
  document.addEventListener("visibilitychange", reportWindowState)
  window.addEventListener("focus", reportWindowState)
  window.addEventListener("blur", reportWindowState)
  window.addEventListener("online", reportNetworkState)
  window.addEventListener("offline", reportNetworkState)

  return () => {
    window.clearInterval(timer)
    observer?.disconnect()
    document.removeEventListener("visibilitychange", reportWindowState)
    window.removeEventListener("focus", reportWindowState)
    window.removeEventListener("blur", reportWindowState)
    window.removeEventListener("online", reportNetworkState)
    window.removeEventListener("offline", reportNetworkState)
  }
}

export function beginDiagnosticRequest(method: string, path: string): (status?: number) => void {
  const startedAt = performance.now()
  let finished = false
  activeRequests += 1
  return (status) => {
    if (finished) return
    finished = true
    activeRequests = Math.max(0, activeRequests - 1)
    lastRequest = {
      completedAt: performance.now(),
      durationMs: elapsed(startedAt),
      group: requestGroup(path),
      method: method.slice(0, 8).toUpperCase(),
      ...(status === undefined ? {} : { status }),
    }
  }
}

export async function trackDiagnosticRefresh<T>(
  name: RefreshName,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now()
  activeRefreshes += 1
  try {
    return await task()
  } finally {
    activeRefreshes = Math.max(0, activeRefreshes - 1)
    lastRefresh = { completedAt: performance.now(), durationMs: elapsed(startedAt), name }
  }
}

export function updateDiagnosticData(next: Partial<typeof data>): void {
  Object.assign(data, next)
}

function snapshot(): RendererRuntimeSnapshot {
  return {
    activeRefreshes,
    activeRequests,
    appActivatedAgeMs: elapsed(lastActivatedAt),
    data: { ...data },
    eventLoopLagMs: rounded(maxEventLoopLagMs),
    documentVisibility: document.visibilityState === "visible" ? "visible" : "hidden",
    ...(lastRefresh
      ? {
          lastRefresh: {
            ageMs: elapsed(lastRefresh.completedAt),
            durationMs: lastRefresh.durationMs,
            name: lastRefresh.name,
          },
        }
      : {}),
    ...(lastRequest
      ? {
          lastRequest: {
            ageMs: elapsed(lastRequest.completedAt),
            durationMs: lastRequest.durationMs,
            group: lastRequest.group,
            method: lastRequest.method,
            ...(lastRequest.status === undefined ? {} : { status: lastRequest.status }),
          },
        }
      : {}),
    longTasks: { count: longTaskCount, maxDurationMs: rounded(maxLongTaskMs) },
    navigatorOnline: navigator.onLine,
    page: currentPage(),
    windowFocused: document.hasFocus(),
    windowMinimized: document.visibilityState !== "visible",
    windowVisible: document.visibilityState === "visible",
  }
}

function currentPage(): RendererRuntimeSnapshot["page"] {
  const segment = window.location.pathname.split("/").filter(Boolean)[0] ?? "setup"
  return (
    (["chat", "contacts", "init", "login", "projects", "setup"] as const).find(
      (value) => value === segment,
    ) ?? "unknown"
  )
}

function requestGroup(path: string): string {
  const segments = path.split("?", 1)[0].split("/").filter(Boolean)
  return segments.slice(0, 3).join("/").slice(0, 80)
}

function elapsed(startedAt: number): number {
  return rounded(performance.now() - startedAt)
}

function rounded(value: number): number {
  return Math.max(0, Math.round(value))
}
