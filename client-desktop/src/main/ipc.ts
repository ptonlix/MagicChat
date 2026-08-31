import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  shell,
  webContents,
  type IpcMainInvokeEvent,
} from "electron"
import type { AuthenticatedTarget, ClientRequest, RealtimeSnapshot } from "@shared/client-contract"
import { IPC, type DesktopThemeSource, type NotificationInput } from "@shared/bridge"
import type { AuthController } from "@main/auth-controller"
import type { ConfigStore } from "@main/config-store"
import type { CredentialStore } from "@main/credential-store"
import { releaseChannel, type Diagnostics } from "@main/diagnostics"
import type { FileService } from "@main/file-service"
import type { HttpTransport } from "@main/http-transport"
import type { NotificationService } from "@main/notification-service"
import type { MessageCacheService } from "@main/message-cache"
import type { RealtimeController } from "@main/realtime-controller"
import type { ServerProfiles } from "@main/server-profiles"
import type { SessionController } from "@main/session-controller"
import type { SystemIntegration } from "@main/system-integration"
import type { StreamingUploadController } from "@main/streaming-upload"
import type { StorageService } from "@main/storage-service"
import type { UpdaterService } from "@main/updater-service"
import { assertTrustedIpcSender } from "@main/ipc-security"
import { parseDesktopSettingsPatch } from "@main/settings-validation"
import { registerRuntimeDiagnosticsIpc } from "@main/runtime-diagnostics-ipc"
import { registerDiagnosticsIpc } from "@main/diagnostics-ipc"
import { parseTrayMessages } from "@main/tray-message-validation"
import { removeServerResources } from "@main/server-removal"
import { handleUnauthorizedCacheLifecycle } from "@main/authentication-cache-lifecycle"
import { broadcastToWindows } from "@main/ipc-broadcast"
import type { ASRController } from "@main/asr-controller"
import type { ASREvent } from "@shared/asr-contract"
import type { DocumentCollaborationEvent } from "@shared/document-collaboration-contract"
import {
  parseDocumentConnectionId,
  parseDocumentSessionId,
  parseDocumentUuid,
} from "@shared/document-collaboration-contract"
import type { DocumentCollaborationController } from "@main/document-collaboration-controller"
import type { DocumentWindowManager } from "@main/document-window-manager"
import { parseExternalWebLink } from "@shared/external-link"
import type { ShortcutManager } from "@main/shortcut-manager"
import type { ShortcutKind } from "@shared/shortcut-contract"
import { realtimeSnapshotDeliveryEvents } from "@main/realtime-snapshot-diagnostics"

export type IpcDependencies = {
  auth: AuthController
  asr: ASRController
  credentials: CredentialStore
  diagnostics: Diagnostics
  documentCollaboration: DocumentCollaborationController
  documentWindows?: DocumentWindowManager
  files: FileService
  http: HttpTransport
  messageCache: MessageCacheService
  notifications: NotificationService
  profiles: ServerProfiles
  realtime: RealtimeController
  sessions: SessionController
  shortcuts: ShortcutManager
  storage: StorageService
  store: ConfigStore
  system: SystemIntegration
  uploads: StreamingUploadController
  updater: UpdaterService
}

export function registerIpc(deps: IpcDependencies): () => void {
  const broadcast = (channel: string, payload: unknown) =>
    broadcastToWindows(channel, payload, BrowserWindow.getAllWindows())
  const markUnauthorized = (authTarget: AuthenticatedTarget) => {
    deps.asr.closeTarget(authTarget)
    deps.documentCollaboration.closeTarget(authTarget)
    deps.documentWindows?.closeTarget(authTarget)
    handleUnauthorizedCacheLifecycle(authTarget, {
      broadcastUnauthorized: (target) => broadcast(IPC.realtimeUnauthorized, target),
      clearUserBestEffort: (target) => deps.messageCache.clearUserBestEffort(target),
      cancelHttp: (target) => deps.http.cancelTarget(target),
      closeRealtime: (target) => deps.realtime.close(target),
    })
  }
  const register = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedIpcSender(event)
      return handler(event, ...args)
    })
  }

  register(IPC.appInfo, () => ({
    arch: process.arch,
    build: process.env.MAGICCHAT_BUILD_ID ?? "local",
    channel: releaseChannel(),
    packaged: app.isPackaged,
    platform: process.platform,
    version: app.getVersion(),
  }))
  register(IPC.asrConnect, (event, rawTarget) =>
    deps.asr.connect(event.sender.id, target(rawTarget)),
  )
  register(IPC.asrSendFrame, (event, sessionId, frame) =>
    deps.asr.sendFrame(event.sender.id, asString(sessionId, 128), frame),
  )
  register(IPC.asrCommit, (event, sessionId) =>
    deps.asr.commit(event.sender.id, asString(sessionId, 128)),
  )
  register(IPC.asrClose, (event, sessionId) =>
    deps.asr.close(event.sender.id, asString(sessionId, 128)),
  )
  register(IPC.documentCollaborationConnect, (event, rawTarget, documentId, connectionId) =>
    deps.documentCollaboration.connect(
      event.sender.id,
      target(rawTarget),
      parseDocumentUuid(documentId),
      parseDocumentConnectionId(connectionId),
    ),
  )
  register(IPC.documentCollaborationCancel, (event, connectionId) =>
    deps.documentCollaboration.cancel(event.sender.id, parseDocumentConnectionId(connectionId)),
  )
  register(IPC.documentCollaborationSend, (event, sessionId, frame) =>
    deps.documentCollaboration.send(event.sender.id, parseDocumentSessionId(sessionId), frame),
  )
  register(IPC.documentCollaborationClose, (event, sessionId) =>
    deps.documentCollaboration.close(event.sender.id, parseDocumentSessionId(sessionId)),
  )
  if (deps.documentWindows)
    register(IPC.documentWindowOpen, (event, rawRequest) =>
      deps.documentWindows?.open(event.sender.id, rawRequest),
    )
  register(IPC.appearanceThemeSet, (_event, source) =>
    deps.system.setThemeSource(themeSource(source)),
  )
  register(IPC.badgeSet, (_event, count) => {
    const validated = asCount(count)
    const enabled = deps.store.getSettings().messageNotificationsEnabled
    deps.system.setBadge(enabled ? validated : 0)
  })
  register(IPC.trayMessagesSet, (_event, messages) => {
    const validated = parseTrayMessages(messages)
    const enabled = deps.store.getSettings().messageNotificationsEnabled
    deps.system.setTrayMessages(enabled ? validated : [])
  })
  register(IPC.clipboardWriteText, (_event, value) =>
    clipboard.writeText(asString(value, 1024 * 1024)),
  )
  register(IPC.clipboardWritePng, (_event, value) => {
    const bytes = asClipboardPng(value)
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) throw new Error("剪贴板图片格式无效")
    clipboard.writeImage(image)
  })
  register(IPC.serversList, () => deps.profiles.list())
  register(IPC.serversAdd, (_event, url, name) =>
    deps.profiles.add(asString(url, 2048), optionalString(name, 120)),
  )
  register(IPC.serversRename, (_event, id, name) =>
    deps.profiles.rename(asId(id), asString(name, 120)),
  )
  register(IPC.serversSelect, async (_event, id) => {
    deps.profiles.require(asId(id))
    await deps.store.setSettings({ selectedServerId: asId(id) })
  })
  register(IPC.serversRemove, (_event, rawId) => {
    const id = asId(rawId)
    const profile = deps.profiles.require(id)
    return removeServerResources(deps, id, profile)
  })
  register(IPC.settingsGet, () => deps.store.getSettings())
  register(IPC.settingsSet, async (_event, rawPatch) => {
    const patch = parseDesktopSettingsPatch(rawPatch)
    const { autoLaunch, ...remaining } = patch
    if (autoLaunch !== undefined) await deps.system.setAutoLaunch(autoLaunch)
    const settings = await deps.store.setSettings(remaining)
    if (remaining.notificationPrivacy !== undefined) deps.system.refreshTray()
    if (remaining.messageNotificationsEnabled === false) {
      deps.system.setBadge(0)
      deps.system.setTrayMessages([])
      deps.system.refreshTray()
    }
    return settings
  })
  register(IPC.storageGetStats, () => deps.storage.getStats())
  register(IPC.storageCacheClear, (_event, kinds) => deps.storage.clearCache(kinds))
  register(IPC.shortcutsGetState, (_event, kind) =>
    deps.shortcuts.getState(parseShortcutKind(kind)),
  )
  register(IPC.shortcutRecordingBegin, (event, kind) =>
    deps.shortcuts.beginRecording(event.sender.id, parseShortcutKind(kind)),
  )
  register(IPC.shortcutRecordingCancel, (event) => deps.shortcuts.cancelRecording(event.sender.id))
  register(IPC.shortcutScreenshotSet, (event, accelerator) =>
    deps.shortcuts.set("screenshot", event.sender.id, accelerator),
  )
  register(IPC.shortcutSearchSet, (event, accelerator) =>
    deps.shortcuts.set("search", event.sender.id, accelerator),
  )
  register(IPC.shortcutSendMessageSet, (event, accelerator) =>
    deps.shortcuts.set("sendMessage", event.sender.id, accelerator),
  )
  register(IPC.transportRequest, async (event, rawTarget, rawRequest) => {
    const authTarget = target(rawTarget)
    const clientRequest = request(rawRequest)
    const isLogout =
      clientRequest.method === "POST" &&
      clientRequest.path.split("?", 1)[0] === "/api/client/auth/logout"
    const response = await deps.http.request(event.sender.id, authTarget, clientRequest)
    if (response.status === 401) markUnauthorized(authTarget)
    const failedEnvelope =
      response.body !== null &&
      typeof response.body === "object" &&
      "success" in response.body &&
      response.body.success === false
    if (isLogout && response.status >= 200 && response.status < 300 && !failedEnvelope) {
      deps.http.cancelTarget(authTarget)
      deps.asr.closeTarget(authTarget)
      deps.documentCollaboration.closeTarget(authTarget)
      deps.documentWindows?.closeTarget(authTarget)
      deps.realtime.close(authTarget)
      deps.messageCache.clearUserBestEffort(authTarget)
    }
    return response
  })
  register(IPC.transportCancel, (event, requestId) =>
    deps.http.cancel(asRequestId(requestId), event.sender.id),
  )
  register(IPC.transportStreamStart, (event, rawTarget, rawRequest) =>
    deps.uploads.start(event.sender.id, target(rawTarget), request(rawRequest)),
  )
  register(IPC.transportStreamChunk, (event, streamId, chunk) =>
    deps.uploads.chunk(event.sender.id, asString(streamId, 64), asBytes(chunk)),
  )
  register(IPC.transportStreamFinish, (event, streamId) =>
    deps.uploads.finish(event.sender.id, asString(streamId, 64)),
  )
  register(IPC.transportStreamAbort, (event, streamId) =>
    deps.uploads.abort(event.sender.id, asString(streamId, 64)),
  )
  register(IPC.realtimeConnect, (_event, rawTarget) => deps.realtime.connect(target(rawTarget)))
  register(IPC.realtimeClose, (_event, rawTarget) => deps.realtime.close(target(rawTarget)))
  register(IPC.realtimeSend, (_event, rawTarget, method, payload) =>
    deps.realtime.send(target(rawTarget), asString(method, 128), payload),
  )
  register(IPC.authStart, (_event, serverId, providerKey) =>
    deps.auth.start(asId(serverId), asString(providerKey, 128)),
  )
  register(IPC.authCancel, (_event, transactionId) =>
    deps.auth.cancel(asString(transactionId, 128)),
  )
  register(IPC.filesPick, (event, options) =>
    deps.files.pick(
      event.sender.id,
      Boolean((options as { multiple?: boolean } | undefined)?.multiple),
    ),
  )
  register(IPC.filesUpload, (event, rawTarget, apiPath, fileId) =>
    deps.files.upload(event.sender.id, target(rawTarget), asString(apiPath, 4096), asId(fileId)),
  )
  register(IPC.filesDownload, (_event, rawTarget, apiPath, name) =>
    deps.files.download(target(rawTarget), asString(apiPath, 4096), asString(name, 256)),
  )
  register(IPC.filesOpenLocation, async (_event, filePath) =>
    deps.files.openLocation(asString(filePath, 4096)),
  )
  register(IPC.openExternal, async (_event, rawUrl) => {
    const link = parseExternalWebLink(asString(rawUrl, 4096))
    if (!link) throw new Error("只允许打开 HTTP 或 HTTPS 外部链接")
    await shell.openExternal(link.url)
  })
  register(IPC.notificationShow, (_event, input) =>
    deps.notifications.show(notificationInput(input)),
  )
  register(IPC.permissionsRequest, async (_event, kind) => {
    if (kind !== "microphone" && kind !== "notifications") throw new Error("权限类型无效")
    return deps.system.requestPermission(kind)
  })
  register(IPC.permissionsOpenSettings, async (_event, kind) => {
    if (kind !== "screen") throw new Error("权限设置类型无效")
    return deps.system.openPermissionSettings(kind)
  })
  register(IPC.updaterCancel, () => deps.updater.cancelDownload())
  register(IPC.updaterCheck, () => deps.updater.check())
  register(IPC.updaterDownload, () => deps.updater.download())
  register(IPC.updaterGetState, () => deps.updater.current())
  register(IPC.updaterInstall, () => deps.updater.install())
  register(IPC.updaterOpenManual, () => deps.updater.openManualDownload())
  register(IPC.updaterOpenRelease, () => deps.updater.openReleasePage())
  register(IPC.diagnosticsExport, () => deps.diagnostics.export())
  register(IPC.messageCacheClearConversation, (_event, scope) =>
    deps.messageCache.clearConversation(scope),
  )
  register(IPC.messageCacheClearUser, (_event, cacheTarget) => {
    const authTarget = target(cacheTarget)
    const result = deps.messageCache.clearUser(authTarget)
    deps.documentWindows?.closeTarget(authTarget)
    return result
  })
  register(IPC.messageCacheCommitAfter, (_event, scope, commit) =>
    deps.messageCache.commitAfter(scope, commit),
  )
  register(IPC.messageCacheCommitBefore, (_event, scope, commit) =>
    deps.messageCache.commitBefore(scope, commit),
  )
  register(IPC.messageCacheCommitLatest, (_event, scope, commit) =>
    deps.messageCache.commitLatest(scope, commit),
  )
  register(IPC.messageCacheGetById, (_event, scope, messageId) =>
    deps.messageCache.getById(scope, messageId),
  )
  register(IPC.messageCacheGetStats, (_event, cacheTarget) =>
    deps.messageCache.getStats(cacheTarget),
  )
  register(IPC.messageCacheGetSyncState, (_event, scope) => deps.messageCache.getSyncState(scope))
  register(IPC.messageCacheListSyncStates, (_event, cacheTarget) =>
    deps.messageCache.listSyncStates(cacheTarget),
  )
  register(IPC.messageCacheReadAround, (_event, scope, targetSeq, limit) =>
    deps.messageCache.readAround(scope, targetSeq, limit),
  )
  register(IPC.messageCacheReadBefore, (_event, scope, beforeSeq, limit) =>
    deps.messageCache.readBefore(scope, beforeSeq, limit),
  )
  register(IPC.messageCacheReadRecent, (_event, scope, limit) =>
    deps.messageCache.readRecent(scope, limit),
  )
  register(IPC.messageCacheRemoveMessage, (_event, scope, messageId, generation) =>
    deps.messageCache.removeMessage(scope, messageId, generation),
  )
  register(IPC.messageCacheUpsert, (_event, scope, records, generation) =>
    deps.messageCache.upsert(scope, records, generation),
  )

  const unregisterRuntimeDiagnostics = registerRuntimeDiagnosticsIpc(deps.diagnostics)
  const unregisterDiagnostics = registerDiagnosticsIpc(deps.diagnostics)

  const envelopeListener = (payload: unknown) => broadcast(IPC.realtimeEvent, payload)
  const snapshotListener = (snapshot: RealtimeSnapshot) => {
    const delivery = broadcast(IPC.realtimeSnapshot, snapshot)
    for (const event of realtimeSnapshotDeliveryEvents(snapshot, delivery))
      void deps.diagnostics.recordEvent(event)
  }
  const asrListener = (ownerId: number, event: ASREvent) => {
    const owner = webContents.fromId(ownerId)
    if (owner && !owner.isDestroyed()) owner.send(IPC.asrEvent, event)
  }
  const documentCollaborationListener = (ownerId: number, event: DocumentCollaborationEvent) => {
    const owner = webContents.fromId(ownerId)
    if (!owner || owner.isDestroyed()) return
    owner.send(
      IPC.documentCollaborationEvent,
      event.type === "message" ? { ...event, data: Uint8Array.from(event.data) } : event,
    )
  }
  const unauthorizedListener = (authTarget: AuthenticatedTarget) => markUnauthorized(authTarget)
  const updaterUnsubscribe = deps.updater.subscribe((state) => broadcast(IPC.updaterState, state))
  deps.realtime.on("envelope", envelopeListener)
  deps.realtime.on("snapshot", snapshotListener)
  deps.realtime.on("unauthorized", unauthorizedListener)
  deps.asr.on("event", asrListener)
  deps.documentCollaboration.on("event", documentCollaborationListener)

  app.on("web-contents-created", (_event, contents) =>
    contents.once("destroyed", () => {
      deps.http.cancelOwner(contents.id)
      deps.asr.closeOwner(contents.id)
      deps.documentCollaboration.closeOwner(contents.id)
      deps.documentWindows?.closeOwner(contents.id)
      deps.files.releaseOwner(contents.id)
      deps.shortcuts.releaseOwner(contents.id)
      deps.uploads.releaseOwner(contents.id)
    }),
  )

  return () => {
    for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel)
    deps.realtime.off("envelope", envelopeListener)
    deps.realtime.off("snapshot", snapshotListener)
    deps.realtime.off("unauthorized", unauthorizedListener)
    deps.asr.off("event", asrListener)
    deps.documentCollaboration.off("event", documentCollaborationListener)
    updaterUnsubscribe()
    unregisterRuntimeDiagnostics()
    unregisterDiagnostics()
  }
}

function themeSource(value: unknown): DesktopThemeSource {
  if (value === "dark" || value === "light" || value === "system") return value
  throw new Error("主题设置无效")
}

function asString(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    /[\u0000]/.test(value)
  )
    throw new Error("参数格式无效")
  return value
}

function optionalString(value: unknown, max: number): string | undefined {
  return value === undefined ? undefined : asString(value, max)
}
function asId(value: unknown): string {
  const result = asString(value, 128)
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error("标识无效")
  return result
}
function asRequestId(value: unknown): string {
  return asId(value)
}

function parseShortcutKind(value: unknown): ShortcutKind {
  if (value === "screenshot" || value === "search" || value === "sendMessage") return value
  throw new Error("快捷键类型无效")
}

function target(value: unknown): AuthenticatedTarget {
  if (!value || typeof value !== "object") throw new Error("认证目标无效")
  const input = value as Record<string, unknown>
  return {
    id: asId(input.id),
    normalizedUrl: asString(input.normalizedUrl, 2048),
    userId: typeof input.userId === "string" ? input.userId.slice(0, 128) : "",
  }
}

function request(value: unknown): ClientRequest {
  if (!value || typeof value !== "object") throw new Error("请求参数无效")
  return value as ClientRequest
}

function asBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > 256 * 1024)
    throw new Error("上传分块无效")
  return value
}

function asClipboardPng(value: unknown): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > 25 * 1024 * 1024
  ) {
    throw new Error("剪贴板图片无效")
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (signature.some((byte, index) => value[index] !== byte))
    throw new Error("剪贴板图片必须为 PNG")
  return value
}

function asCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("角标数量无效")
  return Math.max(0, Math.min(9999, Math.trunc(value)))
}

function notificationInput(value: unknown): NotificationInput {
  if (!value || typeof value !== "object") throw new Error("通知参数无效")
  const input = value as NotificationInput
  return {
    ...input,
    conversationId: asId(input.conversationId),
    messageId: asId(input.messageId),
    target: target(input.target),
    preview: input.preview?.slice(0, 1000),
    sender: input.sender?.slice(0, 120),
    workspace: input.workspace?.slice(0, 120),
  }
}
