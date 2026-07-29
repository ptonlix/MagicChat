import { BrowserWindow, type IpcMainInvokeEvent } from "electron"

import { IPC } from "@shared/bridge"

export type WindowControlIpcRegister = (
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void

export function registerWindowControlIpc(register: WindowControlIpcRegister): void {
  register(IPC.windowClose, (event) => senderWindow(event).close())
  register(IPC.windowMinimize, (event) => senderWindow(event).minimize())
  register(IPC.windowToggleMaximize, (event) => {
    const window = senderWindow(event)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) throw new Error("窗口不可用")
  return window
}
