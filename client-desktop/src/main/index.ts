import path from "node:path"
import { app, dialog, powerMonitor } from "electron"
import { IPC } from "../shared/bridge"
import { AuthController } from "./auth-controller"
import { ConfigStore } from "./config-store"
import { CredentialStore } from "./credential-store"
import { Diagnostics } from "./diagnostics"
import { parseDeepLink } from "./deep-links"
import { FileService } from "./file-service"
import { HttpTransport } from "./http-transport"
import { registerIpc } from "./ipc"
import { installLocalProtocol, registerPrivilegedSchemes } from "./local-protocol"
import { NotificationService } from "./notification-service"
import { RealtimeController } from "./realtime-controller"
import { ProxyAuthPrompt } from "./proxy-auth"
import { ServerProfiles } from "./server-profiles"
import { SessionController } from "./session-controller"
import { runtimeIconPath, SystemIntegration } from "./system-integration"
import { UpdaterService } from "./updater-service"
import { StreamingUploadController } from "./streaming-upload"
import { StartupHealth } from "./startup-health"
import { WindowController } from "./window-controller"

registerPrivilegedSchemes()

const initialDeepLink = process.argv.find((value) => value.startsWith("magicchat://"))
const singleInstance = app.requestSingleInstanceLock({ deepLink: initialDeepLink })
if (!singleInstance) app.quit()
else void start().catch(async (error: unknown) => {
  await app.whenReady()
  dialog.showErrorBox("MagicChat 无法启动", error instanceof Error ? error.message : "桌面客户端初始化失败")
  app.exit(1)
})

async function start(): Promise<void> {
  await app.whenReady()
  app.setAppUserModelId("com.magicchat.desktop")
  registerProtocolClient()
  const diagnostics = new Diagnostics(app.getPath("userData"))
  await diagnostics.initialize()
  const startupHealth = new StartupHealth(app.getPath("userData"), app.getVersion())
  const healthResult = await startupHealth.begin()
  if (healthResult.previousStartupIncomplete) await diagnostics.record("main", "previous-startup-incomplete")
  const store = new ConfigStore(app.getPath("userData"))
  await store.load()
  const profiles = new ServerProfiles(store)
  const sessions = new SessionController()
  installLocalProtocol(path.resolve(__dirname, "../renderer"), profiles, sessions)
  const files = new FileService(profiles, sessions)
  const credentials = new CredentialStore(path.join(app.getPath("userData"), "credentials"))
  const windows = new WindowController(store, diagnostics, path.resolve(__dirname, "../preload/index.cjs"))
  const system = new SystemIntegration(store, windows)
  const proxyAuth = new ProxyAuthPrompt(windows)
  const realtime = new RealtimeController(profiles, sessions, proxyAuth)
  const trayAvailable = system.createTray(runtimeIconPath())
  if (!trayAvailable && process.platform !== "darwin" && store.getSettings().closeBehavior === "background") await store.setSettings({ closeBehavior: "quit" })
  system.configurePermissions()
  const auth = new AuthController(
    profiles,
    sessions,
    (result) => windows.send(IPC.authFinished, result),
    () => windows.current()
  )
  const notifications = new NotificationService(() => store.getSettings(), async (input) => {
    const profile = profiles.require(input.target.id)
    const response = await sessions.for(profile).fetch(`${profile.normalizedUrl}/api/client/me`, { credentials: "include" })
    if (!response.ok) return
    await store.setSettings({ selectedServerId: profile.id })
    await windows.verifyAndNavigate(`/chat/${encodeURIComponent(input.conversationId)}${input.messageId ? `?message=${encodeURIComponent(input.messageId)}` : ""}`)
  })
  const updater = new UpdaterService()
  const http = new HttpTransport(profiles, sessions)
  const uploads = new StreamingUploadController(profiles, sessions)
  const unregisterIpc = registerIpc({ auth, credentials, diagnostics, files, http, notifications, profiles, realtime, sessions, store, system, updater, uploads })

  const hidden = process.argv.includes("--hidden") && store.getSettings().autoLaunch
  const mainWindow = windows.create(hidden)
  mainWindow.webContents.once("did-finish-load", () => void startupHealth.markHealthy())
  powerMonitor.on("resume", () => realtime.reconnectAll())
  powerMonitor.on("unlock-screen", () => realtime.reconnectAll())
  app.on("activate", () => windows.show())
  app.on("second-instance", (_event, argv, _workingDirectory, additionalData) => {
    const data = additionalData as { deepLink?: unknown }
    const link = typeof data.deepLink === "string" ? data.deepLink : argv.find((value) => value.startsWith("magicchat://"))
    if (link) void handleDeepLink(link)
    else windows.show()
  })
  app.on("open-url", (event, url) => { event.preventDefault(); void handleDeepLink(url) })
  app.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return
    event.preventDefault()
    proxyAuth.show(callback, authInfo.host)
  })
  let cleanupStarted = false
  let transferExitConfirmed = false
  app.on("before-quit", (event) => {
    if (cleanupStarted) return
    if (!transferExitConfirmed && (files.hasActiveTransfers() || uploads.hasActiveTransfers())) {
      event.preventDefault()
      const choice = dialog.showMessageBoxSync({ type: "warning", buttons: ["继续传输", "取消传输并退出"], cancelId: 0, defaultId: 0, message: "仍有文件传输正在进行" })
      if (choice === 0) return
      transferExitConfirmed = true
    }
    cleanupStarted = true
    windows.prepareToQuit()
    auth.dispose()
    realtime.closeAll()
    event.preventDefault()
    void files.cleanup().finally(() => { unregisterIpc(); app.quit() })
  })
  process.on("uncaughtException", (error) => void diagnostics.record("main", error.name))
  process.on("unhandledRejection", () => void diagnostics.record("main", "unhandled-rejection"))
  app.on("child-process-gone", (_event, details) => {
    if (details.type === "GPU") void diagnostics.record("gpu", details.reason)
  })
  if (initialDeepLink) await handleDeepLink(initialDeepLink)

  async function handleDeepLink(rawUrl: string): Promise<void> {
    try {
      const action = parseDeepLink(rawUrl, new Set(profiles.list().map((profile) => profile.id)))
      if (action.kind === "unknown-server") {
        const result = await dialog.showMessageBox({ type: "question", buttons: ["取消", "添加服务器"], cancelId: 0, defaultId: 0, message: "此链接指向尚未配置的服务器", detail: "确认前 MagicChat 不会向该服务器发送现有凭据。" })
        if (result.response === 1) windows.send("desktop:v1:unknown-server", { serverId: action.serverId })
        return
      }
      await store.setSettings({ selectedServerId: action.serverId })
      await windows.verifyAndNavigate(`/chat/${encodeURIComponent(action.conversationId)}${action.messageId ? `?message=${encodeURIComponent(action.messageId)}` : ""}`)
    } catch (error) {
      await dialog.showMessageBox({ type: "error", message: "无法打开 MagicChat 链接", detail: error instanceof Error ? error.message : "链接无效" })
    }
  }
}

function registerProtocolClient(): void {
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient("magicchat", process.execPath, [path.resolve(process.argv[1])])
  else app.setAsDefaultProtocolClient("magicchat")
}
