import { app, type IpcMainEvent, type IpcMainInvokeEvent } from "electron"

export function assertTrustedIpcSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const rawUrl = event.senderFrame?.url ?? ""
  if (rawUrl.startsWith("magicchat-app://app/")) return
  if (!app.isPackaged) {
    try {
      const url = new URL(rawUrl)
      if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) return
    } catch {
      // 统一走到拒绝分支。
    }
  }
  throw new Error("IPC 调用来源不受信任")
}
