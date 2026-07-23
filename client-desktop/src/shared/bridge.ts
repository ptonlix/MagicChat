import type {
  AuthenticatedTarget,
  ClientRequest,
  ClientResponse,
  RealtimeEnvelope,
  RealtimeSnapshot,
  ServerTarget,
} from "./client-contract"

export const BRIDGE_VERSION = 1 as const

export const IPC = {
  appInfo: "desktop:v1:app-info",
  authCancel: "desktop:v1:auth-cancel",
  authFinished: "desktop:v1:auth-finished",
  authStart: "desktop:v1:auth-start",
  badgeSet: "desktop:v1:badge-set",
  clipboardWritePng: "desktop:v1:clipboard-write-png",
  clipboardWriteText: "desktop:v1:clipboard-write-text",
  diagnosticsExport: "desktop:v1:diagnostics-export",
  filesDownload: "desktop:v1:files-download",
  filesOpenLocation: "desktop:v1:files-open-location",
  filesPick: "desktop:v1:files-pick",
  filesUpload: "desktop:v1:files-upload",
  notificationShow: "desktop:v1:notification-show",
  navigate: "desktop:v1:navigate",
  openExternal: "desktop:v1:open-external",
  permissionsRequest: "desktop:v1:permissions-request",
  realtimeClose: "desktop:v1:realtime-close",
  realtimeConnect: "desktop:v1:realtime-connect",
  realtimeEvent: "desktop:v1:realtime-event",
  realtimeSend: "desktop:v1:realtime-send",
  realtimeUnauthorized: "desktop:v1:realtime-unauthorized",
  serversAdd: "desktop:v1:servers-add",
  serversList: "desktop:v1:servers-list",
  serversRemove: "desktop:v1:servers-remove",
  serversRename: "desktop:v1:servers-rename",
  serversSelect: "desktop:v1:servers-select",
  settingsGet: "desktop:v1:settings-get",
  settingsSet: "desktop:v1:settings-set",
  transportCancel: "desktop:v1:transport-cancel",
  transportStreamAbort: "desktop:v1:transport-stream-abort",
  transportStreamChunk: "desktop:v1:transport-stream-chunk",
  transportStreamFinish: "desktop:v1:transport-stream-finish",
  transportStreamStart: "desktop:v1:transport-stream-start",
  transportRequest: "desktop:v1:transport-request",
  updaterCheck: "desktop:v1:updater-check",
  updaterDownload: "desktop:v1:updater-download",
  updaterInstall: "desktop:v1:updater-install",
  updaterState: "desktop:v1:updater-state",
  unknownServer: "desktop:v1:unknown-server",
} as const

export type ServerProfile = ServerTarget &
  Readonly<{
    createdAt: string
    displayName: string
    lastUserId?: string
  }>

export type DesktopSettings = Readonly<{
  autoLaunch: boolean
  closeBehavior: "background" | "quit"
  notificationPrivacy: "hidden" | "metadata" | "preview"
  selectedServerId?: string
}>

export type DesktopAppInfo = Readonly<{
  arch: string
  build: string
  channel: "preview" | "stable" | "test"
  packaged: boolean
  platform: string
  version: string
}>

export type DesktopAuthResult = Readonly<{
  error?: string
  status: "canceled" | "error" | "success"
  transactionId: string
  userId?: string
}>

export type UpdaterState = Readonly<{
  errorCode?: string
  progress?: number
  status: "available" | "checking" | "downloaded" | "downloading" | "error" | "idle" | "manual"
  version?: string
}>

export interface DesktopBridge {
  readonly version: typeof BRIDGE_VERSION
  app: { info(): Promise<DesktopAppInfo> }
  badge: { set(count: number): Promise<void> }
  clipboard: {
    writePng(bytes: Uint8Array): Promise<void>
    writeText(value: string): Promise<void>
  }
  auth: {
    cancel(transactionId: string): Promise<void>
    subscribeFinished(listener: (result: DesktopAuthResult) => void): () => void
    start(serverId: string, providerKey: string): Promise<{ transactionId: string }>
  }
  diagnostics: { export(): Promise<{ path?: string }> }
  files: {
    download(target: AuthenticatedTarget, path: string, suggestedName: string): Promise<{ path?: string }>
    openLocation(path: string): Promise<void>
    pick(options?: { multiple?: boolean }): Promise<ReadonlyArray<{ id: string; name: string; size: number }>>
    upload(target: AuthenticatedTarget, apiPath: string, fileId: string): Promise<ClientResponse>
  }
  notifications: { show(input: NotificationInput): Promise<void> }
  navigation: {
    subscribe(listener: (route: string) => void): () => void
    subscribeUnknownServer(listener: (input: { serverId: string }) => void): () => void
  }
  permissions: { request(kind: "microphone" | "notifications"): Promise<boolean> }
  realtime: {
    close(target: AuthenticatedTarget): Promise<void>
    connect(target: AuthenticatedTarget): Promise<RealtimeSnapshot>
    send(target: AuthenticatedTarget, method: string, payload: unknown): Promise<unknown>
    subscribe(listener: (envelope: RealtimeEnvelope) => void): () => void
    subscribeUnauthorized(listener: (target: AuthenticatedTarget) => void): () => void
  }
  servers: {
    add(url: string, displayName?: string): Promise<ServerProfile>
    list(): Promise<ReadonlyArray<ServerProfile>>
    remove(id: string): Promise<void>
    rename(id: string, displayName: string): Promise<ServerProfile>
    select(id: string): Promise<void>
  }
  settings: {
    get(): Promise<DesktopSettings>
    set(patch: Partial<DesktopSettings>): Promise<DesktopSettings>
  }
  shell: { openExternal(url: string): Promise<void> }
  transport: {
    cancel(requestId: string): Promise<void>
    request<T>(target: AuthenticatedTarget, request: ClientRequest): Promise<ClientResponse<T>>
    streamAbort(streamId: string): Promise<void>
    streamChunk(streamId: string, chunk: Uint8Array): Promise<void>
    streamFinish<T>(streamId: string): Promise<ClientResponse<T>>
    streamStart(target: AuthenticatedTarget, request: Pick<ClientRequest, "headers" | "method" | "path" | "requestId">): Promise<string>
  }
  updater: {
    check(): Promise<UpdaterState>
    download(): Promise<void>
    install(): Promise<void>
    subscribe(listener: (state: UpdaterState) => void): () => void
  }
}

export type NotificationInput = Readonly<{
  conversationId: string
  messageId: string
  muted?: boolean
  preview?: string
  sender?: string
  target: AuthenticatedTarget
  workspace?: string
}>
