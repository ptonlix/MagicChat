import { app, BrowserWindow, clipboard, ipcMain, nativeImage, shell, type IpcMainInvokeEvent } from "electron"
import type { AuthenticatedTarget, ClientRequest } from "@shared/client-contract"
import { IPC, type DesktopSettings, type NotificationInput, type TrayMessage } from "@shared/bridge"
import { AuthController } from "@main/auth-controller"
import { ConfigStore } from "@main/config-store"
import { CredentialStore } from "@main/credential-store"
import { Diagnostics, releaseChannel } from "@main/diagnostics"
import { FileService } from "@main/file-service"
import { HttpTransport } from "@main/http-transport"
import { NotificationService } from "@main/notification-service"
import { RealtimeController } from "@main/realtime-controller"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"
import { SystemIntegration } from "@main/system-integration"
import { StreamingUploadController } from "@main/streaming-upload"
import { UpdaterService } from "@main/updater-service"
import { assertTrustedIpcSender } from "@main/ipc-security"
import { registerRuntimeDiagnosticsIpc } from "@main/runtime-diagnostics-ipc"

export type IpcDependencies = {
  auth: AuthController
  credentials: CredentialStore
  diagnostics: Diagnostics
  files: FileService
  http: HttpTransport
  notifications: NotificationService
  profiles: ServerProfiles
  realtime: RealtimeController
  sessions: SessionController
  store: ConfigStore
  system: SystemIntegration
  uploads: StreamingUploadController
  updater: UpdaterService
}

export function registerIpc(deps: IpcDependencies): () => void {
  const broadcast = (channel: string, payload: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const markUnauthorized = (authTarget: AuthenticatedTarget) => {
    deps.realtime.close(authTarget)
    broadcast(IPC.realtimeUnauthorized, authTarget)
  }
  const register = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => { assertTrustedIpcSender(event); return handler(event, ...args) })
  }

  register(IPC.appInfo, () => ({ arch: process.arch, build: process.env.MAGICCHAT_BUILD_ID ?? "local", channel: releaseChannel(), packaged: app.isPackaged, platform: process.platform, version: app.getVersion() }))
  register(IPC.badgeSet, (_event, count) => deps.system.setBadge(asCount(count)))
  register(IPC.trayMessagesSet, (_event, messages) => deps.system.setTrayMessages(trayMessages(messages)))
  register(IPC.clipboardWriteText, (_event, value) => clipboard.writeText(asString(value, 1024 * 1024)))
  register(IPC.clipboardWritePng, (_event, value) => {
    const bytes = asClipboardPng(value)
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) throw new Error("剪贴板图片格式无效")
    clipboard.writeImage(image)
  })
  register(IPC.serversList, () => deps.profiles.list())
  register(IPC.serversAdd, (_event, url, name) => deps.profiles.add(asString(url, 2048), optionalString(name, 120)))
  register(IPC.serversRename, (_event, id, name) => deps.profiles.rename(asId(id), asString(name, 120)))
  register(IPC.serversSelect, async (_event, id) => { deps.profiles.require(asId(id)); await deps.store.setSettings({ selectedServerId: asId(id) }) })
  register(IPC.serversRemove, async (_event, rawId) => {
    const id = asId(rawId)
    const profile = deps.profiles.require(id)
    deps.realtime.closeServer(id)
    deps.uploads.cleanupServer(id)
    await Promise.all([deps.files.cleanupServer(id), deps.sessions.remove(profile), deps.credentials.removeServer(id)])
    await deps.store.removeServer(id)
  })
  register(IPC.settingsGet, () => deps.store.getSettings())
  register(IPC.settingsSet, async (_event, rawPatch) => {
    const patch = settingsPatch(rawPatch)
    const { autoLaunch, ...remaining } = patch
    if (autoLaunch !== undefined) await deps.system.setAutoLaunch(autoLaunch)
    const settings = await deps.store.setSettings(remaining)
    if (remaining.notificationPrivacy !== undefined) deps.system.refreshTray()
    return settings
  })
  register(IPC.transportRequest, async (event, rawTarget, rawRequest) => {
    const authTarget = target(rawTarget)
    const response = await deps.http.request(event.sender.id, authTarget, request(rawRequest))
    if (response.status === 401) markUnauthorized(authTarget)
    return response
  })
  register(IPC.transportCancel, (event, requestId) => deps.http.cancel(asRequestId(requestId), event.sender.id))
  register(IPC.transportStreamStart, (event, rawTarget, rawRequest) => deps.uploads.start(event.sender.id, target(rawTarget), request(rawRequest)))
  register(IPC.transportStreamChunk, (event, streamId, chunk) => deps.uploads.chunk(event.sender.id, asString(streamId, 64), asBytes(chunk)))
  register(IPC.transportStreamFinish, (event, streamId) => deps.uploads.finish(event.sender.id, asString(streamId, 64)))
  register(IPC.transportStreamAbort, (event, streamId) => deps.uploads.abort(event.sender.id, asString(streamId, 64)))
  register(IPC.realtimeConnect, (_event, rawTarget) => deps.realtime.connect(target(rawTarget)))
  register(IPC.realtimeClose, (_event, rawTarget) => deps.realtime.close(target(rawTarget)))
  register(IPC.realtimeSend, (_event, rawTarget, method, payload) => deps.realtime.send(target(rawTarget), asString(method, 128), payload))
  register(IPC.authStart, (_event, serverId, providerKey) => deps.auth.start(asId(serverId), asString(providerKey, 128)))
  register(IPC.authCancel, (_event, transactionId) => deps.auth.cancel(asString(transactionId, 128)))
  register(IPC.filesPick, (event, options) => deps.files.pick(event.sender.id, Boolean((options as { multiple?: boolean } | undefined)?.multiple)))
  register(IPC.filesUpload, (event, rawTarget, apiPath, fileId) => deps.files.upload(event.sender.id, target(rawTarget), asString(apiPath, 4096), asId(fileId)))
  register(IPC.filesDownload, (_event, rawTarget, apiPath, name) => deps.files.download(target(rawTarget), asString(apiPath, 4096), asString(name, 256)))
  register(IPC.filesOpenLocation, async (_event, filePath) => deps.files.openLocation(asString(filePath, 4096)))
  register(IPC.openExternal, async (_event, rawUrl) => {
    const url = new URL(asString(rawUrl, 4096))
    if (url.protocol !== "https:") throw new Error("只允许打开 HTTPS 外部链接")
    await shell.openExternal(url.toString())
  })
  register(IPC.notificationShow, (_event, input) => deps.notifications.show(notificationInput(input)))
  register(IPC.permissionsRequest, async (_event, kind) => {
    if (kind !== "microphone" && kind !== "notifications") throw new Error("权限类型无效")
    return deps.system.requestPermission(kind)
  })
  register(IPC.updaterCheck, () => deps.updater.check())
  register(IPC.updaterDownload, () => deps.updater.download())
  register(IPC.updaterInstall, () => deps.updater.install())
  register(IPC.diagnosticsExport, () => deps.diagnostics.export())

  const unregisterRuntimeDiagnostics = registerRuntimeDiagnosticsIpc(deps.diagnostics)

  const envelopeListener = (payload: unknown) => broadcast(IPC.realtimeEvent, payload)
  const unauthorizedListener = (authTarget: AuthenticatedTarget) => markUnauthorized(authTarget)
  const updaterUnsubscribe = deps.updater.subscribe((state) => broadcast(IPC.updaterState, state))
  deps.realtime.on("envelope", envelopeListener)
  deps.realtime.on("unauthorized", unauthorizedListener)

  app.on("web-contents-created", (_event, contents) => contents.once("destroyed", () => {
    deps.http.cancelOwner(contents.id)
    deps.files.releaseOwner(contents.id)
    deps.uploads.releaseOwner(contents.id)
  }))

  return () => {
    for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel)
    deps.realtime.off("envelope", envelopeListener)
    deps.realtime.off("unauthorized", unauthorizedListener)
    updaterUnsubscribe()
    unregisterRuntimeDiagnostics()
  }
}

function asString(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000]/.test(value)) throw new Error("参数格式无效")
  return value
}
function optionalString(value: unknown, max: number): string | undefined { return value === undefined ? undefined : asString(value, max) }
function asId(value: unknown): string { const result = asString(value, 128); if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error("标识无效"); return result }
function asRequestId(value: unknown): string { return asId(value) }

function target(value: unknown): AuthenticatedTarget {
  if (!value || typeof value !== "object") throw new Error("认证目标无效")
  const input = value as Record<string, unknown>
  return { id: asId(input.id), normalizedUrl: asString(input.normalizedUrl, 2048), userId: typeof input.userId === "string" ? input.userId.slice(0, 128) : "" }
}

function request(value: unknown): ClientRequest {
  if (!value || typeof value !== "object") throw new Error("请求参数无效")
  return value as ClientRequest
}

function asBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > 256 * 1024) throw new Error("上传分块无效")
  return value
}

function asClipboardPng(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > 25 * 1024 * 1024) {
    throw new Error("剪贴板图片无效")
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (signature.some((byte, index) => value[index] !== byte)) throw new Error("剪贴板图片必须为 PNG")
  return value
}

function asCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("角标数量无效")
  return Math.max(0, Math.min(9999, Math.trunc(value)))
}

function trayMessages(value: unknown): TrayMessage[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error("菜单栏消息无效")
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("菜单栏消息无效")
    const message = item as Record<string, unknown>
    return {
      conversationId: asId(message.conversationId),
      name: asString(message.name, 80),
      serverId: asId(message.serverId),
      summary: asString(message.summary, 160),
      unreadCount: asCount(message.unreadCount),
    }
  })
}

function settingsPatch(value: unknown): Partial<DesktopSettings> {
  if (!value || typeof value !== "object") throw new Error("设置参数无效")
  const input = value as Partial<DesktopSettings>
  const allowed = new Set(["autoLaunch", "closeBehavior", "notificationPrivacy", "selectedServerId"])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error("设置字段无效")
  return input
}

function notificationInput(value: unknown): NotificationInput {
  if (!value || typeof value !== "object") throw new Error("通知参数无效")
  const input = value as NotificationInput
  return { ...input, conversationId: asId(input.conversationId), messageId: asId(input.messageId), target: target(input.target), preview: input.preview?.slice(0, 1000), sender: input.sender?.slice(0, 120), workspace: input.workspace?.slice(0, 120) }
}
