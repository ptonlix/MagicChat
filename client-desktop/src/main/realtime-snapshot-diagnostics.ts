import type { RealtimeSnapshot } from "@shared/client-contract"
import type { DiagnosticContext, DiagnosticEventInput } from "@shared/diagnostics-contract"
import type { IpcBroadcastResult } from "@main/ipc-broadcast"

export function realtimeSnapshotDeliveryEvents(
  snapshot: RealtimeSnapshot,
  delivery: IpcBroadcastResult,
): DiagnosticEventInput[] {
  const context = diagnosticContextFromSnapshot(snapshot)
  const shared = { ...(context ? { context } : {}), origin: "main" as const }
  return [
    {
      ...shared,
      data: { deliverySucceededCount: delivery.delivered },
      type: "realtime-bridge.snapshot-sent" as const,
    },
    ...(delivery.failed > 0
      ? [
          {
            ...shared,
            data: { deliveryFailureCount: delivery.failed },
            type: "realtime-bridge.delivery-failed" as const,
          },
        ]
      : []),
  ]
}

function diagnosticContextFromSnapshot(snapshot: RealtimeSnapshot): DiagnosticContext | undefined {
  const context = {
    ...(snapshot.connectionInstanceId
      ? { connectionInstanceId: snapshot.connectionInstanceId }
      : {}),
    ...(snapshot.episodeId ? { episodeId: snapshot.episodeId } : {}),
    ...(snapshot.targetScope ? { targetScope: snapshot.targetScope } : {}),
  }
  return Object.keys(context).length > 0 ? context : undefined
}
