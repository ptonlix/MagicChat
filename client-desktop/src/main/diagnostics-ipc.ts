import { ipcMain, type IpcMainInvokeEvent } from "electron"
import { IPC } from "@shared/bridge"
import { parseDiagnosticEventInput } from "@shared/diagnostics-contract"
import type { Diagnostics } from "@main/diagnostics"
import { assertTrustedIpcSender } from "@main/ipc-security"

export function registerDiagnosticsIpc(diagnostics: Diagnostics): () => void {
  const recordHandler = async (event: IpcMainInvokeEvent, rawEvent: unknown) => {
    assertTrustedIpcSender(event)
    return diagnostics.recordEvent(parseDiagnosticEventInput(rawEvent, new Set(["renderer"])))
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
