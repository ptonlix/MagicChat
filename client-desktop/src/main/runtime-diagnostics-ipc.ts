import { ipcMain, type IpcMainEvent } from "electron"
import { IPC } from "@shared/bridge"
import type { Diagnostics } from "@main/diagnostics"
import { assertTrustedIpcSender } from "@main/ipc-security"
import { parseRendererRuntimeSnapshot } from "@main/runtime-snapshot-validation"

export function registerRuntimeDiagnosticsIpc(diagnostics: Diagnostics): () => void {
  const listener = (event: IpcMainEvent, rawSnapshot: unknown) => {
    try {
      assertTrustedIpcSender(event)
      diagnostics.updateRuntimeSnapshot(parseRendererRuntimeSnapshot(rawSnapshot))
    } catch {
      // 单向诊断通道拒绝无效数据，不让错误影响主进程稳定性。
    }
  }
  ipcMain.on(IPC.diagnosticsRuntime, listener)
  return () => ipcMain.removeListener(IPC.diagnosticsRuntime, listener)
}
