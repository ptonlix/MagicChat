import { contextBridge, ipcRenderer } from "electron"
import {
  BRIDGE_VERSION,
  IPC,
  type DesktopAuthResult,
  type DesktopBridge,
  type UpdaterState,
} from "@shared/bridge"
import type { RealtimeEnvelope } from "@shared/client-contract"

const bridge: DesktopBridge = {
  version: BRIDGE_VERSION,
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
  appearance: {
    setThemeSource: (source) => ipcRenderer.invoke(IPC.appearanceThemeSet, source),
  },
  badge: { set: (count) => ipcRenderer.invoke(IPC.badgeSet, count) },
  tray: { setMessages: (messages) => ipcRenderer.invoke(IPC.trayMessagesSet, messages) },
  clipboard: {
    writePng: (bytes) => ipcRenderer.invoke(IPC.clipboardWritePng, bytes),
    writeText: (value) => ipcRenderer.invoke(IPC.clipboardWriteText, value),
  },
  auth: {
    cancel: (transactionId) => ipcRenderer.invoke(IPC.authCancel, transactionId),
    subscribeFinished: (listener) => subscribe<DesktopAuthResult>(IPC.authFinished, listener),
    start: (serverId, providerKey) => ipcRenderer.invoke(IPC.authStart, serverId, providerKey),
  },
  diagnostics: {
    export: () => ipcRenderer.invoke(IPC.diagnosticsExport),
    reportRuntime: (snapshot) => ipcRenderer.send(IPC.diagnosticsRuntime, snapshot),
  },
  files: {
    download: (target, path, name) => ipcRenderer.invoke(IPC.filesDownload, target, path, name),
    openLocation: (path) => ipcRenderer.invoke(IPC.filesOpenLocation, path),
    pick: (options) => ipcRenderer.invoke(IPC.filesPick, options),
    upload: (target, path, fileId) => ipcRenderer.invoke(IPC.filesUpload, target, path, fileId),
  },
  messageCache: {
    clearConversation: (scope) => ipcRenderer.invoke(IPC.messageCacheClearConversation, scope),
    clearUser: (target) => ipcRenderer.invoke(IPC.messageCacheClearUser, target),
    commitAfter: (scope, input) => ipcRenderer.invoke(IPC.messageCacheCommitAfter, scope, input),
    commitBefore: (scope, input) => ipcRenderer.invoke(IPC.messageCacheCommitBefore, scope, input),
    commitLatest: (scope, input) => ipcRenderer.invoke(IPC.messageCacheCommitLatest, scope, input),
    getById: (scope, messageId) => ipcRenderer.invoke(IPC.messageCacheGetById, scope, messageId),
    getStats: (target) => ipcRenderer.invoke(IPC.messageCacheGetStats, target),
    getSyncState: (scope) => ipcRenderer.invoke(IPC.messageCacheGetSyncState, scope),
    listSyncStates: (target) => ipcRenderer.invoke(IPC.messageCacheListSyncStates, target),
    readBefore: (scope, beforeSeq, limit) =>
      ipcRenderer.invoke(IPC.messageCacheReadBefore, scope, beforeSeq, limit),
    readRecent: (scope, limit) => ipcRenderer.invoke(IPC.messageCacheReadRecent, scope, limit),
    removeMessage: (scope, messageId, generation) =>
      ipcRenderer.invoke(IPC.messageCacheRemoveMessage, scope, messageId, generation),
    upsert: (scope, records, generation) =>
      ipcRenderer.invoke(IPC.messageCacheUpsert, scope, records, generation),
  },
  notifications: { show: (input) => ipcRenderer.invoke(IPC.notificationShow, input) },
  navigation: {
    subscribe: (listener) => subscribe<string>(IPC.navigate, listener),
    subscribeUnknownServer: (listener) =>
      subscribe<{ serverId: string }>(IPC.unknownServer, listener),
  },
  permissions: { request: (kind) => ipcRenderer.invoke(IPC.permissionsRequest, kind) },
  realtime: {
    close: (target) => ipcRenderer.invoke(IPC.realtimeClose, target),
    connect: (target) => ipcRenderer.invoke(IPC.realtimeConnect, target),
    send: (target, method, payload) =>
      ipcRenderer.invoke(IPC.realtimeSend, target, method, payload),
    subscribe: (listener) => subscribe<RealtimeEnvelope>(IPC.realtimeEvent, listener),
    subscribeUnauthorized: (listener) => subscribe(IPC.realtimeUnauthorized, listener),
  },
  servers: {
    add: (url, name) => ipcRenderer.invoke(IPC.serversAdd, url, name),
    list: () => ipcRenderer.invoke(IPC.serversList),
    remove: (id) => ipcRenderer.invoke(IPC.serversRemove, id),
    rename: (id, name) => ipcRenderer.invoke(IPC.serversRename, id, name),
    select: (id) => ipcRenderer.invoke(IPC.serversSelect, id),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  },
  shell: { openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url) },
  transport: {
    cancel: (requestId) => ipcRenderer.invoke(IPC.transportCancel, requestId),
    request: (target, request) => ipcRenderer.invoke(IPC.transportRequest, target, request),
    streamAbort: (streamId) => ipcRenderer.invoke(IPC.transportStreamAbort, streamId),
    streamChunk: (streamId, chunk) => ipcRenderer.invoke(IPC.transportStreamChunk, streamId, chunk),
    streamFinish: (streamId) => ipcRenderer.invoke(IPC.transportStreamFinish, streamId),
    streamStart: (target, request) => ipcRenderer.invoke(IPC.transportStreamStart, target, request),
  },
  updater: {
    check: () => ipcRenderer.invoke(IPC.updaterCheck),
    download: () => ipcRenderer.invoke(IPC.updaterDownload),
    getState: () => ipcRenderer.invoke(IPC.updaterGetState),
    install: () => ipcRenderer.invoke(IPC.updaterInstall),
    openManualDownload: () => ipcRenderer.invoke(IPC.updaterOpenManual),
    openReleasePage: () => ipcRenderer.invoke(IPC.updaterOpenRelease),
    subscribe: (listener) => subscribe<UpdaterState>(IPC.updaterState, listener),
  },
}

if (process.argv.includes("--magicchat-proxy-auth")) {
  contextBridge.exposeInMainWorld(
    "proxyAuth",
    Object.freeze({
      cancel: () => ipcRenderer.send("desktop:internal:proxy-auth-cancel"),
      submit: (username: string, password: string) =>
        ipcRenderer.send("desktop:internal:proxy-auth-submit", { password, username }),
    }),
  )
} else {
  contextBridge.exposeInMainWorld("desktop", Object.freeze(bridge))
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
