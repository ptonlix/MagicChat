export type IpcBroadcastWindow = Readonly<{
  isDestroyed(): boolean
  webContents: Readonly<{ send(channel: string, payload: unknown): void }>
}>

export type IpcBroadcastResult = Readonly<{ delivered: number; failed: number }>

export function broadcastToWindows(
  channel: string,
  payload: unknown,
  windows: ReadonlyArray<IpcBroadcastWindow>,
): IpcBroadcastResult {
  let delivered = 0
  let failed = 0
  for (const window of windows) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send(channel, payload)
      delivered += 1
    } catch {
      failed += 1
    }
  }
  return { delivered, failed }
}
