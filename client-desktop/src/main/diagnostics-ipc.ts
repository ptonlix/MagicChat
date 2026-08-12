import { ipcMain, type IpcMainInvokeEvent } from "electron"
import { IPC } from "@shared/bridge"
import { parseDiagnosticEventInput } from "@shared/diagnostics-contract"
import type { Diagnostics } from "@main/diagnostics"
import { assertTrustedIpcSender } from "@main/ipc-security"

const maxPendingRecordsPerRenderer = 32

export function registerDiagnosticsIpc(diagnostics: Diagnostics): () => void {
  const pendingRecordsBySender = new Map<number, number>()
  const recordHandler = async (event: IpcMainInvokeEvent, rawEvent: unknown) => {
    assertTrustedIpcSender(event)
    const record = parseDiagnosticEventInput(rawEvent, new Set(["renderer"]))
    const senderId = event.sender.id
    const pending = pendingRecordsBySender.get(senderId) ?? 0
    if (pending >= maxPendingRecordsPerRenderer) return undefined
    pendingRecordsBySender.set(senderId, pending + 1)
    try {
      return await diagnostics.recordEvent(record)
    } finally {
      const remaining = (pendingRecordsBySender.get(senderId) ?? 1) - 1
      if (remaining > 0) pendingRecordsBySender.set(senderId, remaining)
      else pendingRecordsBySender.delete(senderId)
    }
  }
  const storageStatsHandler = async (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSender(event)
    return diagnostics.getStorageStats()
  }
  const storageClearHandler = async (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSender(event)
    return diagnostics.clearStorage()
  }
  ipcMain.handle(IPC.diagnosticsEvent, recordHandler)
  ipcMain.handle(IPC.diagnosticsStorageGetStats, storageStatsHandler)
  ipcMain.handle(IPC.diagnosticsStorageClear, storageClearHandler)
  return () => {
    ipcMain.removeHandler(IPC.diagnosticsEvent)
    ipcMain.removeHandler(IPC.diagnosticsStorageGetStats)
    ipcMain.removeHandler(IPC.diagnosticsStorageClear)
  }
}
