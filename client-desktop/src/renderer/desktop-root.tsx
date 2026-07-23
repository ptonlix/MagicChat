import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import {
  ArrowRight,
  BellRing,
  ChevronRight,
  CircleHelp,
  Download,
  HardDriveDownload,
  LockKeyhole,
  MessageCircleMore,
  MonitorCog,
  Server,
  ShieldCheck,
  Sparkles,
  UsersRound,
  XIcon,
} from "lucide-react"
import { BrowserRouter } from "react-router"
import { configureDesktopHost } from "@/lib/desktop-host"
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
import { startRuntimeDiagnostics } from "@/lib/runtime-diagnostics"
import { releaseChannelLabel } from "@/release-channel"
import { BrandLoadingScreen } from "@/components/brand-loading-screen"

export function DesktopRoot() {
  const [profiles, setProfiles] = useState<ReadonlyArray<ServerProfile>>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)

  useEffect(() => startRuntimeDiagnostics(), [])

  useEffect(() => {
    void Promise.all([window.desktop.servers.list(), window.desktop.settings.get()]).then(
      ([items, settings]) => {
        setProfiles(items)
        setSelectedId(settings.selectedServerId ?? items[0]?.id)
        setLoading(false)
      },
    )
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

  if (loading) return <StatusPage text="正在启动即应" />
  const selected = profiles.find((profile) => profile.id === selectedId)
  if (!selected) return <ServerSetup onAdded={added} />
  return (
    <DesktopWorkspace
      key={`${selected.id}:${selected.lastUserId ?? "anonymous"}`}
      profile={selected}
      onRemoved={removed}
    />
  )
}

function DesktopWorkspace({
  profile,
  onRemoved,
}: {
  profile: ServerProfile
  onRemoved(serverId: string): void
}) {
  const [userId, setUserId] = useState(profile.lastUserId ?? "anonymous")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const target = useMemo<AuthenticatedTarget>(
    () => ({ id: profile.id, normalizedUrl: profile.normalizedUrl, userId }),
    [profile.id, profile.normalizedUrl, userId],
  )
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  return (
    <div className="desktop-frame">
      <div className="desktop-content">
        <ThemeProvider>
          <TooltipProvider>
            <BrowserRouter>
              <DesktopHostedApp
                profile={profile}
                target={target}
                onAuthenticated={setUserId}
                onOpenSettings={openSettings}
              />
              <Toaster position="top-center" />
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </div>
      {settingsOpen && (
        <DesktopSettingsPanel
          profile={profile}
          onOpenChange={setSettingsOpen}
          onRemoved={onRemoved}
        />
      )}
    </div>
  )
}

function DesktopHostedApp({
  profile,
  target,
  onAuthenticated,
  onOpenSettings,
}: {
  profile: ServerProfile
  target: AuthenticatedTarget
  onAuthenticated(userId: string): void
  onOpenSettings(): void
}) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const restoreFetch = installDesktopFetch(target)
    const restoreHost = configureDesktopHost({
      cancelThirdPartyLogin: (transactionId) => window.desktop.auth.cancel(transactionId),
      createRealtimeClient: (options) =>
        new RealtimeClient({
          ...options,
          createWebSocket: () => new DesktopWebSocket(target),
          url: "desktop://realtime",
        }),
      downloadTemporaryFile: async (fileId, fileName) => {
        await window.desktop.files.download(
          target,
          `/api/client/temporary-files/${encodeURIComponent(fileId)}/content`,
          fileName,
        )
      },
      openSettings: onOpenSettings,
      openThirdPartyLogin: (providerKey) => window.desktop.auth.start(profile.id, providerKey),
      notificationPermission: () => "granted",
      openExternal: (url) => window.desktop.shell.openExternal(url),
      requestMicrophonePermission: () => window.desktop.permissions.request("microphone"),
      requestNotificationPermission: async () =>
        (await window.desktop.permissions.request("notifications")) ? "granted" : "denied",
      resolveResourceUrl: (url) => resolveDesktopResourceUrl(profile, url),
      setBadge: (count) => {
        void window.desktop.badge.set(count)
      },
      setTrayMessages: (messages) => {
        void window.desktop.tray.setMessages(
          messages.map((message) => ({ ...message, serverId: profile.id })),
        )
      },
      showMessageNotification: (input) => {
        void window.desktop.notifications.show({ ...input, target, workspace: profile.displayName })
        return true
      },
      subscribeThirdPartyLoginFinished: (listener) =>
        window.desktop.auth.subscribeFinished(listener),
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
  }, [onAuthenticated, onOpenSettings, profile, target])

  return ready ? <App /> : <StatusPage detail={profile.displayName} text="正在连接工作空间" />
}

function DesktopSettingsPanel({
  profile,
  onOpenChange,
  onRemoved,
}: {
  profile: ServerProfile
  onOpenChange(open: boolean): void
  onRemoved(serverId: string): void
}) {
  const [settings, setSettings] = useState<DesktopSettings>()
  const [appInfo, setAppInfo] = useState<DesktopAppInfo>()
  const [updater, setUpdater] = useState<UpdaterState>({ status: "idle" })
  const [name, setName] = useState(profile.displayName)
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState("")

  useEffect(() => {
    void Promise.all([window.desktop.settings.get(), window.desktop.app.info()]).then(
      ([nextSettings, nextInfo]) => {
        setSettings(nextSettings)
        setAppInfo(nextInfo)
      },
    )
    return window.desktop.updater.subscribe(setUpdater)
  }, [])

  async function updateSettings(patch: Partial<DesktopSettings>) {
    setSettings(await window.desktop.settings.set(patch))
  }

  async function renameServer() {
    setBusy(true)
    try {
      await window.desktop.servers.rename(profile.id, name)
      window.location.reload()
    } finally {
      setBusy(false)
    }
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
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        aria-describedby={undefined}
        aria-label="设置"
        className="desktop-settings"
        side="right"
        showCloseButton={false}
      >
        <SheetHeader className="desktop-settings-header">
          <div className="desktop-settings-brand">
            <img alt="即应" src="/logo.png" />
            <div>
              <SheetTitle>设置</SheetTitle>
              <p>让即应更符合你的工作习惯</p>
            </div>
          </div>
          <button
            aria-label="关闭设置"
            className="desktop-icon-button"
            onClick={() => onOpenChange(false)}
            title="关闭设置"
            type="button"
          >
            <XIcon size={17} />
          </button>
        </SheetHeader>
        {!settings ? (
          <div className="desktop-settings-loading">
            <Sparkles size={18} />
            <span>正在准备设置</span>
          </div>
        ) : (
          <div className="desktop-setting-list">
            <div className="desktop-settings-summary">
              <div className="desktop-settings-summary-icon">
                <ShieldCheck size={20} />
              </div>
              <div>
                <strong>桌面体验已连接</strong>
                <span>{profile.displayName}</span>
              </div>
              <span className="desktop-status-pill">运行正常</span>
            </div>
            <section className="desktop-setting-section">
              <div className="desktop-setting-section-heading">
                <MonitorCog size={17} />
                <div>
                  <h3>应用行为</h3>
                  <p>启动、关闭与后台运行方式</p>
                </div>
              </div>
              <label className="desktop-setting-card">
                <span>
                  <strong>关闭窗口</strong>
                  <small>选择点击关闭按钮后的行为</small>
                </span>
                <select
                  value={settings.closeBehavior}
                  onChange={(event) =>
                    void updateSettings({
                      closeBehavior: event.target.value as DesktopSettings["closeBehavior"],
                    })
                  }
                >
                  <option value="background">保持后台运行</option>
                  <option value="quit">退出应用</option>
                </select>
              </label>
              <label className="desktop-setting-card desktop-checkbox">
                <span>
                  <strong>开机自动启动</strong>
                  <small>登录系统后在后台静默启动</small>
                </span>
                <input
                  checked={settings.autoLaunch}
                  type="checkbox"
                  onChange={(event) => void updateSettings({ autoLaunch: event.target.checked })}
                />
              </label>
            </section>
            <section className="desktop-setting-section">
              <div className="desktop-setting-section-heading">
                <BellRing size={17} />
                <div>
                  <h3>通知与隐私</h3>
                  <p>控制系统通知展示的信息</p>
                </div>
              </div>
              <label className="desktop-setting-card">
                <span>
                  <strong>通知内容</strong>
                  <small>敏感环境建议隐藏正文预览</small>
                </span>
                <select
                  value={settings.notificationPrivacy}
                  onChange={(event) =>
                    void updateSettings({
                      notificationPrivacy: event.target
                        .value as DesktopSettings["notificationPrivacy"],
                    })
                  }
                >
                  <option value="hidden">隐藏通知内容</option>
                  <option value="metadata">仅显示发送者或会话</option>
                  <option value="preview">显示消息预览</option>
                </select>
              </label>
            </section>
            <section className="desktop-setting-section">
              <div className="desktop-setting-section-heading">
                <Server size={17} />
                <div>
                  <h3>工作空间</h3>
                  <p>当前连接的服务器信息</p>
                </div>
              </div>
              <label className="desktop-setting-card desktop-setting-card-stack">
                <span>
                  <strong>显示名称</strong>
                  <small>仅影响此设备上的展示</small>
                </span>
                <div className="desktop-inline">
                  <input
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button
                    disabled={busy || !name.trim() || name.trim() === profile.displayName}
                    onClick={() => void renameServer()}
                  >
                    保存
                  </button>
                </div>
              </label>
              <div className="desktop-server-address desktop-setting-card">
                <span>
                  <strong>服务器地址</strong>
                  <small>已通过安全连接访问</small>
                </span>
                <p>{profile.normalizedUrl}</p>
              </div>
              <button
                className="desktop-danger"
                disabled={busy}
                onClick={() => void removeServer()}
              >
                移除服务器
              </button>
              {removeError && <p role="alert">{removeError}</p>}
            </section>
            <section className="desktop-setting-section">
              <div className="desktop-setting-section-heading">
                <CircleHelp size={17} />
                <div>
                  <h3>关于即应</h3>
                  <p>版本、更新与诊断工具</p>
                </div>
              </div>
              <div className="desktop-setting-card desktop-about-card">
                <div className="desktop-about-icon">
                  <HardDriveDownload size={18} />
                </div>
                <div>
                  <strong>当前版本</strong>
                  <p>
                    {appInfo
                      ? `${appInfo.version} · ${appInfo.platform} ${appInfo.arch} · ${releaseChannelLabel(appInfo.channel)}`
                      : "正在读取"}
                  </p>
                  <small>{updateStatusText(updater)}</small>
                </div>
                <button
                  className="desktop-icon-action"
                  aria-label="检查更新"
                  onClick={() => void window.desktop.updater.check().then(setUpdater)}
                  title="检查更新"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              {updater.status === "available" && (
                <button
                  className="desktop-primary-action"
                  onClick={() => void window.desktop.updater.download()}
                >
                  <Download size={16} />
                  下载 {updater.version}
                </button>
              )}
              {updater.status === "downloaded" && (
                <button
                  className="desktop-primary-action"
                  onClick={() => void window.desktop.updater.install()}
                >
                  <Sparkles size={16} />
                  安装并重启
                </button>
              )}
              <button
                className="desktop-secondary-action"
                onClick={() => void window.desktop.diagnostics.export()}
              >
                导出脱敏诊断
              </button>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function updateStatusText(state: UpdaterState): string {
  if (state.status === "manual") return "当前测试通道或安装来源仅支持手动升级"
  if (state.status === "downloading") return `正在下载 ${Math.round(state.progress ?? 0)}%`
  if (state.status === "error") return `更新失败：${state.errorCode ?? "unknown"}`
  if (state.status === "idle") return "当前版本可继续使用"
  return state.status === "checking"
    ? "正在检查"
    : state.status === "downloaded"
      ? "更新已下载"
      : `发现 ${state.version ?? "新版本"}`
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
    try {
      onAdded(await window.desktop.servers.add(url, name || undefined))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法添加服务器")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="server-setup">
      <div className="server-setup-shell">
        <section className="server-setup-hero">
          <div className="server-setup-brand">
            <img alt="即应" src="/logo.png" />
            <div>
              <strong>即应</strong>
              <span>Desktop</span>
            </div>
          </div>

          <div className="server-setup-hero-copy">
            <span className="server-setup-eyebrow">
              <Sparkles size={14} />A BETTER WAY TO WORK
            </span>
            <h1>
              从沟通到行动，
              <br />
              让协作持续向前
            </h1>
            <p>
              即应是一款面向企业团队的沟通与协作平台。它把聊天、AI
              应用、项目与任务放进同一个上下文，让沟通不止被看见，更能继续向前。
            </p>
          </div>

          <div className="server-setup-benefits">
            <div>
              <span>
                <MessageCircleMore size={17} />
              </span>
              <div>
                <strong>即时沟通</strong>
                <p>消息、文件与上下文始终保持同步</p>
              </div>
            </div>
            <div>
              <span>
                <UsersRound size={17} />
              </span>
              <div>
                <strong>团队协作</strong>
                <p>联系人、项目与会话集中在一处</p>
              </div>
            </div>
            <div>
              <span>
                <ShieldCheck size={17} />
              </span>
              <div>
                <strong>安全连接</strong>
                <p>凭据仅发送到你确认的工作空间</p>
              </div>
            </div>
          </div>

          <div className="server-setup-hero-footer">
            <span />
            即应 · 企业协作空间
          </div>
        </section>

        <section className="server-setup-form-panel">
          <div className="server-setup-form-card">
            <div className="server-setup-form-heading">
              <span>连接团队空间</span>
              <h2>开始使用即应</h2>
              <p>输入管理员提供的服务器地址，即可进入你的团队工作空间。</p>
            </div>

            <form onSubmit={(event) => void submit(event)}>
              <label>
                <span>
                  <strong>服务器地址</strong>
                  <small>必填</small>
                </span>
                <input
                  aria-label="服务器地址"
                  autoFocus
                  required
                  type="url"
                  placeholder="https://chat.example.com"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <label>
                <span>
                  <strong>显示名称</strong>
                  <small>可选</small>
                </span>
                <input
                  aria-label="显示名称"
                  maxLength={120}
                  placeholder="例如：产品团队"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <button disabled={busy} type="submit">
                <span>{busy ? "正在验证连接" : "连接并继续"}</span>
                <ArrowRight size={17} />
              </button>
            </form>

            <div className="server-setup-security">
              <LockKeyhole size={14} />
              <span>仅连接你信任的服务器地址</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function StatusPage({ detail, text }: { detail?: string; text: string }) {
  return <BrandLoadingScreen detail={detail ?? "正在准备你的桌面工作空间"} message={text} />
}
