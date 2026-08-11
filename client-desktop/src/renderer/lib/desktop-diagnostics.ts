import type {
  DiagnosticContext,
  DiagnosticDataForType,
  DiagnosticEvent,
  DiagnosticType,
} from "@shared/diagnostics-contract"
import { createDiagnosticEventInput } from "@shared/diagnostics-contract"
import { ClientTransportError } from "@shared/client-contract"
import { ClientDataRequestError } from "@/lib/client-api/core"
import { MessageCatchUpError } from "@/lib/messages/message-catch-up"

type ParseFailureWindow = {
  firstEventSeq?: number
  startedAt: string
  suppressedCount: number
  timer?: number
}

let parseFailureWindow: ParseFailureWindow | undefined

export function createDiagnosticId(): string {
  return crypto.randomUUID().replace(/-/g, "")
}

export function recordRendererDiagnostic<Type extends DiagnosticType>(
  type: Type,
  context?: DiagnosticContext,
  data?: DiagnosticDataForType<Type>,
): Promise<DiagnosticEvent | undefined> {
  const diagnostics = window.desktop?.diagnostics
  if (!diagnostics?.record) return Promise.resolve(undefined)
  return diagnostics
    .record(
      createDiagnosticEventInput(
        type,
        "renderer",
        context && Object.keys(context).length > 0 ? context : undefined,
        data && Object.keys(data).length > 0 ? data : undefined,
      ),
    )
    .catch(() => undefined)
}

export function recordRealtimeParseFailure(): void {
  if (!parseFailureWindow) {
    const windowStartedAt = new Date().toISOString()
    parseFailureWindow = { startedAt: windowStartedAt, suppressedCount: 0 }
    void recordRendererDiagnostic("realtime.event-parse-failed", undefined, {
      error: { category: "parse", phase: "request" },
    }).then((event) => {
      if (parseFailureWindow?.startedAt === windowStartedAt)
        parseFailureWindow.firstEventSeq = event?.eventSeq
    })
    return
  }

  parseFailureWindow.suppressedCount += 1
  if (parseFailureWindow.timer !== undefined) return
  parseFailureWindow.timer = window.setTimeout(flushParseFailureWindow, 30_000)
}

export function flushParseFailureWindow(): void {
  const current = parseFailureWindow
  parseFailureWindow = undefined
  if (!current || current.suppressedCount === 0) return
  void recordRendererDiagnostic("realtime.parse-failures-aggregated", undefined, {
    suppressedCount: current.suppressedCount,
    suppressedFromEventSeq: current.firstEventSeq ?? 0,
    suppressedToEventSeq: current.firstEventSeq ?? 0,
    windowEndedAt: new Date().toISOString(),
    windowStartedAt: current.startedAt,
  })
}

export function classifyDiagnosticError(
  error: unknown,
): "cache" | "concurrent" | "http" | "network" | "parse" | "stale" | "unknown" | "unmounted" {
  if (error instanceof DOMException && error.name === "AbortError") return "unmounted"
  if (error instanceof Error && error.name === "MessageOperationCancelledError") return "stale"
  if (error instanceof ClientDataRequestError)
    return error.status === undefined ? "unknown" : "http"
  if (error instanceof ClientTransportError) {
    if (error.status !== undefined) return "http"
    if (error.code === "aborted") return "unmounted"
    if (error.code === "network" || error.code === "timeout" || error.code === "tls")
      return "network"
    return "unknown"
  }
  if (error instanceof MessageCatchUpError) {
    if (error.code === "cache") return "cache"
    if (error.code === "protocol_cursor") return "parse"
    return classifyDiagnosticError(error.cause) === "http" ? "http" : "network"
  }
  if (error instanceof SyntaxError) return "parse"
  if (error instanceof TypeError) return "network"
  return "unknown"
}
