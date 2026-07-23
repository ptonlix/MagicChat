import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { XIcon } from "lucide-react"
import { BrowserRouter } from "react-router"
import { createDesktopRealtimeClient, configureDesktopHost } from "@/lib/desktop-host"
import { RealtimeClient } from "@/lib/realtime-client"
import { ThemeProvider } from "@/components/theme-provider"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import App from "@/app/App"
import type { AuthenticatedTarget } from "@shared/client-contract"
import type { DesktopAppInfo, DesktopSettings, ServerProfile, UpdaterState } from "@shared/bridge"
import { DesktopWebSocket, installDesktopFetch } from "./desktop-transport"
import { resolveDesktopResourceUrl } from "@/lib/desktop-resource-url"
import { installDesktopLinkNavigation } from "@/lib/desktop-link-navigation"

export function DesktopRoot() {
  const [profiles, setProfiles] = useState<ReadonlyArray<ServerProfile>>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void Promise.all([window.desktop.servers.list(), window.desktop.settings.get()]).then(([items, settings]) => {
      setProfiles(items)
      setSelectedId(settings.selectedServerId ?? items[0]?.id)
      setLoading(false)
    })
    return window.desktop.navigation.subscribeUnknownServer(({ serverId }) => {
      window.alert(`链接指向尚未配置的服务器 ${serverId}，请先添加并确认服务器地址。`)
      setSelectedId(undefined)
    })
  }, [])

  async function select(id: string) {
    await window.desktop.servers.select(id)
    setSelectedId(id)
  }

  async function added(profile: ServerProfile) {
    const items = await window.desktop.servers.list()
    setProfiles(items)
    await select(profile.id)
  }

  function removed(serverId: string) {
    setProfiles((items) => items.filter((profile) => profile.id !== serverId))
    setSelectedId(undefined)
  }

  if (loading) return <StatusPage text="正在启动 MagicChat" />
  const selected = profiles.find((profile) => profile.id === selectedId)
  if (!selected) return <ServerSetup onAdded={added} />
  return <DesktopWorkspace key={`${selected.id}:${selected.lastUserId ?? "anonymous"}`} profile={selected} onRemoved={removed} />
}

function DesktopWorkspace({ profile, onRemoved }: { profile: ServerProfile; onRemoved(serverId: string): void }) {
  const [userId, setUserId] = useState(profile.lastUserId ?? "anonymous")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const target = useMemo<AuthenticatedTarget>(() => ({ id: profile.id, normalizedUrl: profile.normalizedUrl, userId }), [profile.id, profile.normalizedUrl, userId])
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  return (
    <div className="desktop-frame">
      <div className="desktop-content">
        <ThemeProvider>
          <TooltipProvider>
            <BrowserRouter>
              <DesktopHostedApp profile={profile} target={target} onAuthenticated={setUserId} onOpenSettings={openSettings} />
              <Toaster position="top-center" />
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </div>
      {settingsOpen && <DesktopSettingsPanel profile={profile} onOpenChange={setSettingsOpen} onRemoved={onRemoved} />}
    </div>
  )
}

function DesktopHostedApp({ profile, target, onAuthenticated, onOpenSettings }: { profile: ServerProfile; target: AuthenticatedTarget; onAuthenticated(userId: string): void; onOpenSettings(): void }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const restoreFetch = installDesktopFetch(target)
    const restoreHost = configureDesktopHost({
      cancelThirdPartyLogin: (transactionId) => window.desktop.auth.cancel(transactionId),
      createRealtimeClient: (options) => new RealtimeClient({ ...options, createWebSocket: () => new DesktopWebSocket(target), url: "desktop://realtime" }),
      downloadTemporaryFile: async (fileId, fileName) => {
        await window.desktop.files.download(target, `/api/client/temporary-files/${encodeURIComponent(fileId)}/content`, fileName)
      },
      openSettings: onOpenSettings,
      openThirdPartyLogin: (providerKey) => window.desktop.auth.start(profile.id, providerKey),
      notificationPermission: () => "granted",
      openExternal: (url) => window.desktop.shell.openExternal(url),
      requestMicrophonePermission: () => window.desktop.permissions.request("microphone"),
      requestNotificationPermission: async () => await window.desktop.permissions.request("notifications") ? "granted" : "denied",
      resolveResourceUrl: (url) => resolveDesktopResourceUrl(profile, url),
      setBadge: (count) => { void window.desktop.badge.set(count) },
      showMessageNotification: (input) => {
        void window.desktop.notifications.show({ ...input, target, workspace: profile.displayName })
        return true
      },
      subscribeThirdPartyLoginFinished: (listener) => window.desktop.auth.subscribeFinished(listener),
      writeClipboardPng: (bytes) => window.desktop.clipboard.writePng(bytes),
      writeClipboardText: (value) => window.desktop.clipboard.writeText(value),
    })
    const authenticated = (event: Event) => {
      const id = (event as CustomEvent<{ userId?: string }>).detail?.userId
      if (id && id !== target.userId) onAuthenticated(id)
    }
    const unsubscribeAuth = window.desktop.auth.subscribeFinished((result) => {
      if (result.status === "success") window.location.reload()
    })
    const unsubscribeNavigation = window.desktop.navigation.subscribe((route) => {
      if (!route.startsWith("/") || route.length > 2048) return
      window.history.pushState({}, "", route)
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    const restoreLinkNavigation = installDesktopLinkNavigation((url) => {
      void window.desktop.shell.openExternal(url)
    })
    window.addEventListener("magicchat:authenticated", authenticated)
    setReady(true)
    return () => {
      setReady(false)
      window.removeEventListener("magicchat:authenticated", authenticated)
      restoreLinkNavigation()
      unsubscribeAuth()
      unsubscribeNavigation()
      restoreHost()
      restoreFetch()
    }
  }, [onAuthenticated, onOpenSettings, profile.displayName, profile.id, target])

  return ready ? <App /> : <StatusPage text="正在连接服务器" />
}

function DesktopSettingsPanel({ profile, onOpenChange, onRemoved }: { profile: ServerProfile; onOpenChange(open: boolean): void; onRemoved(serverId: string): void }) {
  const [settings, setSettings] = useState<DesktopSettings>()
  const [appInfo, setAppInfo] = useState<DesktopAppInfo>()
  const [updater, setUpdater] = useState<UpdaterState>({ status: "idle" })
  const [name, setName] = useState(profile.displayName)
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState("")

  useEffect(() => {
    void Promise.all([window.desktop.settings.get(), window.desktop.app.info()]).then(([nextSettings, nextInfo]) => { setSettings(nextSettings); setAppInfo(nextInfo) })
    return window.desktop.updater.subscribe(setUpdater)
  }, [])

  async function updateSettings(patch: Partial<DesktopSettings>) {
    setSettings(await window.desktop.settings.set(patch))
  }

  async function renameServer() {
    setBusy(true)
    try { await window.desktop.servers.rename(profile.id, name); window.location.reload() }
    finally { setBusy(false) }
  }

  async function removeServer() {
    if (!window.confirm(`移除“${profile.displayName}”及其本地会话、缓存和凭据？`)) return
    setBusy(true)
    setRemoveError("")
    try {
      await window.desktop.servers.remove(profile.id)
      onOpenChange(false)
      onRemoved(profile.id)
    } catch (reason) {
      setRemoveError(reason instanceof Error ? reason.message : "移除服务器失败")
    }
    finally { setBusy(false) }
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined} aria-label="设置" className="desktop-settings" side="right" showCloseButton={false}>
        <SheetHeader className="desktop-settings-header">
          <SheetTitle>设置</SheetTitle>
          <button aria-label="关闭设置" className="desktop-icon-button" onClick={() => onOpenChange(false)} title="关闭设置" type="button"><XIcon size={17} /></button>
        </SheetHeader>
        {!settings ? <p>正在加载</p> : <div className="desktop-setting-list">
          <section className="desktop-setting-section">
            <h3>通用</h3>
            <label>关闭窗口
              <select value={settings.closeBehavior} onChange={(event) => void updateSettings({ closeBehavior: event.target.value as DesktopSettings["closeBehavior"] })}>
                <option value="background">保持后台运行</option><option value="quit">退出应用</option>
              </select>
            </label>
            <label className="desktop-checkbox"><input checked={settings.autoLaunch} type="checkbox" onChange={(event) => void updateSettings({ autoLaunch: event.target.checked })} /><span>登录系统后静默启动</span></label>
            <label>通知隐私
              <select value={settings.notificationPrivacy} onChange={(event) => void updateSettings({ notificationPrivacy: event.target.value as DesktopSettings["notificationPrivacy"] })}>
                <option value="hidden">完全隐藏</option><option value="metadata">显示发送者或会话</option><option value="preview">显示脱敏正文预览</option>
              </select>
            </label>
          </section>
          <section className="desktop-setting-section">
            <h3>服务器</h3>
            <label>显示名称<div className="desktop-inline"><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /><button disabled={busy || !name.trim() || name.trim() === profile.displayName} onClick={() => void renameServer()}>重命名</button></div></label>
            <div className="desktop-server-address"><span>服务器地址</span><p>{profile.normalizedUrl}</p></div>
            <button className="desktop-danger" disabled={busy} onClick={() => void removeServer()}>移除服务器</button>
            {removeError && <p role="alert">{removeError}</p>}
          </section>
          <section className="desktop-setting-section">
            <h3>关于</h3>
            <div className="desktop-setting-group"><span>版本</span><p>{appInfo ? `${appInfo.version} · ${appInfo.platform} ${appInfo.arch} · ${appInfo.channel}` : "正在读取"}</p><div className="desktop-setting-actions"><button onClick={() => void window.desktop.updater.check().then(setUpdater)}>检查更新</button>{updater.status === "available" && <button onClick={() => void window.desktop.updater.download()}>下载 {updater.version}</button>}{updater.status === "downloaded" && <button onClick={() => void window.desktop.updater.install()}>安装并重启</button>}</div><small>{updateStatusText(updater)}</small></div>
            <div className="desktop-setting-group"><span>诊断</span><button onClick={() => void window.desktop.diagnostics.export()}>导出脱敏诊断</button></div>
          </section>
        </div>}
      </SheetContent>
    </Sheet>
  )
}

function updateStatusText(state: UpdaterState): string {
  if (state.status === "manual") return "当前测试通道或安装来源仅支持手动升级"
  if (state.status === "downloading") return `正在下载 ${Math.round(state.progress ?? 0)}%`
  if (state.status === "error") return `更新失败：${state.errorCode ?? "unknown"}`
  if (state.status === "idle") return "当前版本可继续使用"
  return state.status === "checking" ? "正在检查" : state.status === "downloaded" ? "更新已下载" : `发现 ${state.version ?? "新版本"}`
}

function ServerSetup({ onAdded }: { onAdded(profile: ServerProfile): void }) {
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try { onAdded(await window.desktop.servers.add(url, name || undefined)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法添加服务器") }
    finally { setBusy(false) }
  }

  return (
    <main className="server-setup">
      <section>
        <img alt="MagicChat" src="/logo.png" />
        <h1>连接 MagicChat Server</h1>
        <form onSubmit={(event) => void submit(event)}>
          <label>服务器地址<input required type="url" placeholder="https://chat.example.com" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
          <label>显示名称<input maxLength={120} placeholder="可选" value={name} onChange={(event) => setName(event.target.value)} /></label>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy} type="submit">{busy ? "正在验证" : "添加并继续"}</button>
        </form>
      </section>
    </main>
  )
}

function StatusPage({ text }: { text: string }) { return <main className="status-page"><p>{text}</p></main> }
