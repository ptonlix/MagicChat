import { RealtimeClient } from "@/lib/realtime-client"
import type { DesktopAuthResult } from "@shared/bridge"

export type DesktopRendererHost = {
  createRealtimeClient?: (options: { authCheck: () => Promise<boolean>; onUnauthorized: () => void }) => RealtimeClient
  cancelThirdPartyLogin?: (transactionId: string) => Promise<void>
  downloadTemporaryFile?: (fileId: string, fileName: string) => Promise<void>
  openSettings?: () => void
  openThirdPartyLogin?: (providerKey: string) => Promise<{ transactionId: string }>
  requestMicrophonePermission?: () => Promise<boolean>
  notificationPermission?: () => "default" | "denied" | "granted" | "unsupported"
  openExternal?: (url: string) => Promise<void>
  requestNotificationPermission?: () => Promise<"default" | "denied" | "granted" | "unsupported">
  resolveResourceUrl?: (url: string) => string
  setBadge?: (count: number) => void
  showMessageNotification?: (input: { conversationId: string; messageId: string; preview: string; sender: string }) => boolean
  subscribeThirdPartyLoginFinished?: (listener: (result: DesktopAuthResult) => void) => () => void
  writeClipboardPng?: (bytes: Uint8Array) => Promise<void>
  writeClipboardText?: (value: string) => Promise<void>
}

export function getHostNotificationPermission() { return desktopRendererHost.notificationPermission?.() }
export function requestHostNotificationPermission() { return desktopRendererHost.requestNotificationPermission?.() }
export function requestHostMicrophonePermission() { return desktopRendererHost.requestMicrophonePermission?.() }
export function setHostBadge(count: number) { desktopRendererHost.setBadge?.(count) }
export function resolveHostResourceUrl(url: string) { return desktopRendererHost.resolveResourceUrl?.(url) ?? url }
export function openHostSettings(): boolean {
  if (!desktopRendererHost.openSettings) return false
  desktopRendererHost.openSettings()
  return true
}
export async function downloadHostTemporaryFile(fileId: string, fileName: string): Promise<boolean> {
  if (!desktopRendererHost.downloadTemporaryFile) return false
  await desktopRendererHost.downloadTemporaryFile(fileId, fileName)
  return true
}
export function showHostMessageNotification(input: { conversationId: string; messageId: string; preview: string; sender: string }) {
  return desktopRendererHost.showMessageNotification?.(input) ?? false
}
export function openHostExternal(url: string) {
  if (!desktopRendererHost.openExternal) throw new Error("外部链接能力不可用")
  return desktopRendererHost.openExternal(url)
}
export function writeHostClipboardText(value: string) {
  if (!desktopRendererHost.writeClipboardText) throw new Error("剪贴板能力不可用")
  return desktopRendererHost.writeClipboardText(value)
}
export function writeHostClipboardPng(bytes: Uint8Array) {
  if (!desktopRendererHost.writeClipboardPng) throw new Error("剪贴板能力不可用")
  return desktopRendererHost.writeClipboardPng(bytes)
}

let desktopRendererHost: DesktopRendererHost = {}

export function configureDesktopHost(host: DesktopRendererHost): () => void {
  const previous = desktopRendererHost
  desktopRendererHost = Object.freeze({ ...host })
  return () => { desktopRendererHost = previous }
}

export function createDesktopRealtimeClient(options: { authCheck: () => Promise<boolean>; onUnauthorized: () => void }): RealtimeClient {
  return desktopRendererHost.createRealtimeClient?.(options) ?? new RealtimeClient(options)
}

export async function openThirdPartyLogin(providerKey: string): Promise<{ transactionId: string }> {
  if (!desktopRendererHost.openThirdPartyLogin) throw new Error("第三方登录能力不可用")
  return desktopRendererHost.openThirdPartyLogin(providerKey)
}

export async function cancelThirdPartyLogin(transactionId: string): Promise<void> {
  if (!desktopRendererHost.cancelThirdPartyLogin) throw new Error("第三方登录取消能力不可用")
  await desktopRendererHost.cancelThirdPartyLogin(transactionId)
}

export function subscribeThirdPartyLoginFinished(
  listener: (result: DesktopAuthResult) => void
): () => void {
  return desktopRendererHost.subscribeThirdPartyLoginFinished?.(listener) ?? (() => undefined)
}
