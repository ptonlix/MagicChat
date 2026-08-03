import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  ArrowRight,
  BellRing,
  CircleHelp,
  Download,
  ExternalLink,
  HardDriveDownload,
  LockKeyhole,
  MessageCircleMore,
  MonitorCog,
  PanelRightClose,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
} from "lucide-react"
import { BrowserRouter } from "react-router"
import { toast } from "sonner"
import { configureDesktopHost } from "@/lib/desktop-host"
import { RealtimeClient } from "@/lib/realtime-client"
import { ThemeProvider } from "@/components/theme-provider"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import App from "@/app/App"
import type { AuthenticatedTarget } from "@shared/client-contract"
import type {
  DesktopAppInfo,
  DesktopSettings,
  DesktopSettingsPatch,
  ServerProfile,
  UpdaterInstallResult,
  UpdaterState,
} from "@shared/bridge"
import { DesktopWebSocket, installDesktopFetch } from "./desktop-transport"
import { resolveDesktopResourceUrl } from "@/lib/desktop-resource-url"
import { installDesktopLinkNavigation } from "@/lib/desktop-link-navigation"
import { cn } from "@/lib/utils"
import { startRuntimeDiagnostics } from "@/lib/runtime-diagnostics"
import { showScreenshotStartError } from "@/lib/screenshot-start-error"
import { releaseChannelLabel } from "@/release-channel"
import { BrandLoadingScreen } from "@/components/brand-loading-screen"
import { clearManagedMessageCache, configureMessageCacheTarget } from "@/lib/messages"
import type { MessageCacheStats } from "@shared/message-cache-contract"

export function DesktopRoot() {
  const platform = useDesktopPlatform()

  useEffect(
    () =>
      window.desktop.screenshot.subscribeStartFailed(({ code }) => {
        showScreenshotStartError(code)
      }),
    [],
  )

  return (
    <ThemeProvider>
      <TooltipProvider>
        <div className="desktop-frame">
          <DesktopTitlebar platform={platform} />
          <div className="desktop-content">
            <DesktopRootContent platform={platform} />
          </div>
        </div>
        <Toaster position="top-center" />
      </TooltipProvider>
    </ThemeProvider>
  )
}

function useDesktopPlatform() {
  const [platform, setPlatform] = useState<string>()

  useEffect(() => {
    let mounted = true
    void window.desktop.app.info().then(
      (info) => {
        if (mounted) setPlatform(info.platform)
      },
      () => undefined,
    )
    return () => {
      mounted = false
    }
  }, [])

  return platform
}

function DesktopTitlebar({ platform }: { platform?: string }) {
  return (
    <div className="desktop-titlebar-drag-region">
      {platform && platform !== "darwin" && (
        <div className="desktop-titlebar-brand">
          <img alt="即应" draggable={false} src="/logo.png" />
        </div>
      )}
    </div>
  )
}

function DesktopRootContent({ platform }: { platform?: string }) {
  const [profiles, setProfiles] = useState<ReadonlyArray<ServerProfile>>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [messageSoundEnabled, setMessageSoundEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const { setUpdater, updater } = useDesktopUpdaterState()

  useEffect(() => startRuntimeDiagnostics(), [])

  useEffect(() => {
    void Promise.all([window.desktop.servers.list(), window.desktop.settings.get()]).then(
      ([items, settings]) => {
        setProfiles(items)
        setMessageSoundEnabled(settings.messageSoundEnabled)
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

  const selected = profiles.find((profile) => profile.id === selectedId)

  return (
    <>
      {loading ? (
        <StatusPage text="正在启动即应" />
      ) : selected ? (
        <DesktopWorkspace
          key={`${selected.id}:${selected.lastUserId ?? "anonymous"}`}
          messageSoundEnabled={messageSoundEnabled}
          platform={platform}
          profile={selected}
          updater={updater}
          onMessageSoundEnabledChange={setMessageSoundEnabled}
          onRemoved={removed}
          onUpdaterChange={setUpdater}
        />
      ) : (
        <ServerSetup onAdded={added} />
      )}
    </>
  )
}

function DesktopWorkspace({
  messageSoundEnabled,
  platform,
  profile,
  updater,
  onMessageSoundEnabledChange,
  onRemoved,
  onUpdaterChange,
}: {
  messageSoundEnabled: boolean
  platform?: string
  profile: ServerProfile
  updater: UpdaterState
  onMessageSoundEnabledChange(enabled: boolean): void
  onRemoved(serverId: string): void
  onUpdaterChange(state: UpdaterState): void
}) {
  const [userId, setUserId] = useState(profile.lastUserId ?? "anonymous")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const target = useMemo<AuthenticatedTarget>(
    () => ({ id: profile.id, normalizedUrl: profile.normalizedUrl, userId }),
    [profile.id, profile.normalizedUrl, userId],
  )
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  return (
    <>
      <BrowserRouter>
        <DesktopHostedApp
          messageSoundEnabled={messageSoundEnabled}
          profile={profile}
          target={target}
          updater={updater}
          onAuthenticated={setUserId}
          onOpenSettings={openSettings}
          onUpdaterChange={onUpdaterChange}
        />
      </BrowserRouter>
      {settingsOpen && (
        <DesktopSettingsPanel
          platform={platform}
          profile={profile}
          target={target}
          updater={updater}
          onMessageSoundEnabledChange={onMessageSoundEnabledChange}
          onOpenChange={setSettingsOpen}
          onRemoved={onRemoved}
          onUpdaterChange={onUpdaterChange}
        />
      )}
    </>
  )
}

function useDesktopUpdaterState() {
  const [updater, setUpdater] = useState<UpdaterState>({
    currentVersion: "",
    installMode: "manual",
    installationSource: "development",
    retryable: false,
    status: "manual",
  })

  useEffect(() => {
    let disposed = false
    let receivedUpdate = false
    const unsubscribe = window.desktop.updater.subscribe((state) => {
      receivedUpdate = true
      setUpdater(state)
    })
    void window.desktop.updater
      .getState()
      .then((state) => {
        if (!disposed && !receivedUpdate) setUpdater(state)
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return { setUpdater, updater }
}

function useDesktopUpdateAction(onError: (message: string) => void) {
  const [actionPending, setActionPending] = useState(false)
  const actionPendingRef = useRef(false)

  const runUpdateAction = useCallback(
    async (action: () => Promise<void>) => {
      if (actionPendingRef.current) return
      actionPendingRef.current = true
      setActionPending(true)
      try {
        await action()
      } catch {
        onError("更新操作失败，请稍后重试")
      } finally {
        actionPendingRef.current = false
        setActionPending(false)
      }
    },
    [onError],
  )

  return { actionPending, runUpdateAction }
}

function showUpdateActionToast(message: string) {
  toast.error(message)
}

function DesktopUpdatePrompt({
  onStateChange,
  state,
}: {
  onStateChange(state: UpdaterState): void
  state: UpdaterState
}) {
  const { actionPending, runUpdateAction } = useDesktopUpdateAction(showUpdateActionToast)
  const hasNewVersion =
    Boolean(state.targetVersion) &&
    ["available", "downloaded", "downloading", "error", "installing"].includes(state.status)

  if (!hasNewVersion) return null

  function handleUpdateAction() {
    if (state.status === "downloading" || state.status === "installing") return
    void runUpdateAction(async () => {
      if (state.status === "available") {
        if (state.installMode === "ota") await window.desktop.updater.download()
        else await window.desktop.updater.openManualDownload()
        return
      }
      if (state.status === "downloaded") {
        const result = await window.desktop.updater.install()
        if (result.status !== "started") toast.error(getUpdateInstallErrorMessage(result.reason))
        return
      }
      if (state.status === "error") {
        if (state.errorCode === "platform_signature_required" || !state.retryable) {
          await window.desktop.updater.openManualDownload()
        } else {
          onStateChange(await window.desktop.updater.check())
        }
      }
    })
  }

  const Icon =
    state.status === "downloaded"
      ? Sparkles
      : state.status === "error"
        ? CircleHelp
        : state.status === "downloading" || state.status === "installing"
          ? RefreshCw
          : Download
  const label = updatePromptLabel(state)
  const actionDisabled =
    actionPending || state.status === "downloading" || state.status === "installing"

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-disabled={actionDisabled}
            className="desktop-update-prompt"
            onClick={handleUpdateAction}
            title={state.targetVersion ? `${label} · 即应 ${state.targetVersion}` : label}
            type="button"
          >
            <Icon
              aria-hidden="true"
              className={
                state.status === "downloading" || state.status === "installing"
                  ? "motion-safe:animate-spin"
                  : ""
              }
              size={16}
            />
            <span className="sr-only">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          {state.targetVersion ? `${label} · ${state.targetVersion}` : label}
        </TooltipContent>
      </Tooltip>
      <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {label}
      </span>
    </>
  )
}

function DesktopHostedApp({
  messageSoundEnabled,
  profile,
  target,
  updater,
  onAuthenticated,
  onOpenSettings,
  onUpdaterChange,
}: {
  messageSoundEnabled: boolean
  profile: ServerProfile
  target: AuthenticatedTarget
  updater: UpdaterState
  onAuthenticated(userId: string): void
  onOpenSettings(): void
  onUpdaterChange(state: UpdaterState): void
}) {
  const [ready, setReady] = useState(false)
  const messageSoundEnabledRef = useRef(messageSoundEnabled)

  useEffect(() => {
    messageSoundEnabledRef.current = messageSoundEnabled
  }, [messageSoundEnabled])

  useEffect(() => {
    const restoreFetch = installDesktopFetch(target)
    const restoreMessageCacheTarget = configureMessageCacheTarget(target)
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
      messageNotificationSoundEnabled: () => messageSoundEnabledRef.current,
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
        void window.desktop.tray
          .setMessages(messages.map((message) => ({ ...message, serverId: profile.id })))
          .catch(() => undefined)
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
      restoreMessageCacheTarget()
    }
  }, [onAuthenticated, onOpenSettings, profile, target])

  return ready ? (
    <App updatePrompt={<DesktopUpdatePrompt state={updater} onStateChange={onUpdaterChange} />} />
  ) : (
    <StatusPage detail={profile.displayName} text="正在连接工作空间" />
  )
}

function DesktopSettingsPanel({
  platform,
  profile,
  target,
  updater,
  onMessageSoundEnabledChange,
  onOpenChange,
  onRemoved,
  onUpdaterChange,
}: {
  platform?: string
  profile: ServerProfile
  target: AuthenticatedTarget
  updater: UpdaterState
  onMessageSoundEnabledChange(enabled: boolean): void
  onOpenChange(open: boolean): void
  onRemoved(serverId: string): void
  onUpdaterChange(state: UpdaterState): void
}) {
  const usesTitleBarOverlay = platform !== "darwin"
  const [settings, setSettings] = useState<DesktopSettings>()
  const [appInfo, setAppInfo] = useState<DesktopAppInfo>()
  const [name, setName] = useState(profile.displayName)
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState("")
  const [settingsError, setSettingsError] = useState("")
  const [cacheStats, setCacheStats] = useState<MessageCacheStats>()
  const [cacheClearing, setCacheClearing] = useState(false)

  useEffect(() => {
    void Promise.all([
      window.desktop.settings.get(),
      window.desktop.app.info(),
      window.desktop.messageCache.getStats(target).catch(() => undefined),
    ]).then(([nextSettings, nextInfo, nextCacheStats]) => {
      setSettings(nextSettings)
      setAppInfo(nextInfo)
      setCacheStats(nextCacheStats)
    })
  }, [target])

  async function clearMessageCache() {
    if (!window.confirm("清理当前账户的本地消息缓存？")) return
    setCacheClearing(true)
    setSettingsError("")
    try {
      const managed = await clearManagedMessageCache(target)
      if (!managed) await window.desktop.messageCache.clearUser(target)
      setCacheStats(await window.desktop.messageCache.getStats(target))
    } catch {
      setSettingsError("本地消息缓存清理失败，请重试")
    } finally {
      setCacheClearing(false)
    }
  }

  async function updateSettings(patch: DesktopSettingsPatch) {
    setSettingsError("")
    try {
      const nextSettings = await window.desktop.settings.set(patch)
      setSettings(nextSettings)
      if (patch.messageSoundEnabled !== undefined) {
        onMessageSoundEnabledChange(nextSettings.messageSoundEnabled)
      }
    } catch {
      setSettingsError("设置保存失败，请重试")
    }
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
        className={cn("desktop-settings", usesTitleBarOverlay && "desktop-settings-below-titlebar")}
        overlayClassName={
          usesTitleBarOverlay ? "desktop-settings-overlay-below-titlebar" : undefined
        }
        side="right"
        showCloseButton={false}
      >
        <SheetHeader className="desktop-settings-header">
          <button
            aria-label="收起设置面板"
            className="desktop-icon-button desktop-settings-close"
            onClick={() => onOpenChange(false)}
            title="收起设置面板"
            type="button"
          >
            <PanelRightClose aria-hidden="true" size={18} />
          </button>
          <div className="desktop-settings-brand">
            <img alt="即应" src="/logo.png" />
            <div>
              <SheetTitle>设置</SheetTitle>
              <p>让即应更符合你的工作习惯</p>
            </div>
          </div>
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
            {settingsError && <p role="alert">{settingsError}</p>}
            <DesktopAboutSettingsSection
              appInfo={appInfo}
              state={updater}
              onClose={() => onOpenChange(false)}
              onStateChange={onUpdaterChange}
            />
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
              <label className="desktop-setting-card desktop-checkbox">
                <span>
                  <strong>新消息提示音</strong>
                  <small>收到普通新消息时播放提示音</small>
                </span>
                <input
                  aria-label="新消息提示音"
                  checked={settings.messageSoundEnabled}
                  type="checkbox"
                  onChange={(event) =>
                    void updateSettings({ messageSoundEnabled: event.target.checked })
                  }
                />
              </label>
            </section>
            <section className="desktop-setting-section">
              <div className="desktop-setting-section-heading">
                <HardDriveDownload size={17} />
                <div>
                  <h3>本地消息缓存</h3>
                  <p>最近消息的本机恢复数据</p>
                </div>
              </div>
              <div className="desktop-setting-card">
                <span>
                  <strong>{formatCacheSize(cacheStats?.payloadBytes ?? 0)}</strong>
                  <small>{cacheStatusText(cacheStats?.status)}</small>
                </span>
                <button
                  aria-label="清理本地消息缓存"
                  className="desktop-icon-action"
                  disabled={cacheClearing}
                  onClick={() => void clearMessageCache()}
                  title="清理本地消息缓存"
                  type="button"
                >
                  <Trash2 size={17} />
                </button>
              </div>
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
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function cacheStatusText(status: MessageCacheStats["status"] | undefined): string {
  if (status === "available") return "缓存可用，不包含附件文件"
  if (status === "rebuilding") return "正在重建缓存，在线聊天不受影响"
  if (status === "degraded") return "缓存暂不可用，已切换为内存模式"
  return "正在读取缓存状态"
}

function DesktopAboutSettingsSection({
  appInfo,
  onClose,
  onStateChange,
  state,
}: {
  appInfo?: DesktopAppInfo
  onClose(): void
  onStateChange(state: UpdaterState): void
  state: UpdaterState
}) {
  const [updateActionError, setUpdateActionError] = useState("")
  const { actionPending, runUpdateAction } = useDesktopUpdateAction(setUpdateActionError)
  const showMacManualUpdate =
    state.installationSource === "mac_app" &&
    Boolean(state.targetVersion) &&
    (state.status === "available" || state.status === "error")

  function runSettingsUpdateAction(action: () => Promise<void>) {
    setUpdateActionError("")
    void runUpdateAction(action)
  }

  return (
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
        <div className="min-w-0">
          <strong>当前版本</strong>
          <p>
            {appInfo
              ? `${appInfo.version} · ${appInfo.platform} ${appInfo.arch} · ${releaseChannelLabel(appInfo.channel)}`
              : "正在读取"}
          </p>
          <small>{updateStatusText(state)}</small>
          {state.targetVersion && <small>目标版本：{state.targetVersion}</small>}
          <small>安装来源：{installationSourceLabel(state.installationSource)}</small>
        </div>
        <button
          aria-label="检查更新"
          className="desktop-icon-action"
          disabled={
            actionPending ||
            state.status === "checking" ||
            state.status === "downloading" ||
            state.status === "installing"
          }
          onClick={() =>
            runSettingsUpdateAction(async () => {
              onStateChange(await window.desktop.updater.check())
            })
          }
          title="检查更新"
          type="button"
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {state.targetVersion && (
        <button
          className="desktop-release-link"
          disabled={actionPending}
          onClick={() =>
            runSettingsUpdateAction(async () => {
              await window.desktop.updater.openReleasePage()
            })
          }
          type="button"
        >
          <ExternalLink size={15} />
          查看发布内容
        </button>
      )}
      {state.status === "available" &&
        (state.installMode === "ota" ? (
          <button
            className="desktop-primary-action"
            disabled={actionPending || !state.retryable}
            onClick={() =>
              runSettingsUpdateAction(async () => {
                await window.desktop.updater.download()
              })
            }
            type="button"
          >
            <Download size={16} />
            {state.installationSource === "mac_app"
              ? "下载并自动更新"
              : `下载 ${state.targetVersion}`}
          </button>
        ) : (
          <button
            className="desktop-primary-action"
            disabled={actionPending}
            onClick={() =>
              runSettingsUpdateAction(async () => {
                await window.desktop.updater.openManualDownload()
              })
            }
            type="button"
          >
            <Download size={16} />
            {state.manualAction?.label ?? "手动升级"}
          </button>
        ))}
      {state.status === "manual" && state.manualAction && (
        <button
          className="desktop-primary-action"
          disabled={actionPending}
          onClick={() =>
            runSettingsUpdateAction(async () => {
              await window.desktop.updater.openManualDownload()
            })
          }
          type="button"
        >
          <Download size={16} />
          {state.manualAction.label}
        </button>
      )}
      {state.status === "downloaded" && (
        <div className="grid grid-cols-2 gap-2">
          <button className="desktop-secondary-action" onClick={onClose} type="button">
            稍后
          </button>
          <button
            className="desktop-primary-action"
            disabled={actionPending}
            onClick={() =>
              runSettingsUpdateAction(async () => {
                const result = await window.desktop.updater.install()
                if (result.status === "started") return
                setUpdateActionError(getUpdateInstallErrorMessage(result.reason))
              })
            }
            type="button"
          >
            <Sparkles size={16} />
            安装并重启
          </button>
        </div>
      )}
      {state.status === "error" && state.retryable && (
        <button
          className="desktop-primary-action"
          disabled={actionPending}
          onClick={() =>
            runSettingsUpdateAction(async () => {
              onStateChange(await window.desktop.updater.check())
            })
          }
          type="button"
        >
          重试检查
        </button>
      )}
      {showMacManualUpdate && (
        <div className="desktop-mac-update-guide">
          <strong>手动更新 macOS</strong>
          <p>自动更新不可用时，可以下载安装包覆盖当前版本，聊天记录和本地设置会保留。</p>
          <ol>
            <li>下载并打开 DMG 安装包</li>
            <li>将 MagicChat 拖入“应用程序”，选择替换</li>
            <li>重新打开 MagicChat，确认版本已更新</li>
          </ol>
          <button
            className="desktop-primary-action"
            disabled={actionPending}
            onClick={() =>
              runSettingsUpdateAction(async () => {
                await window.desktop.updater.openManualDownload()
              })
            }
            type="button"
          >
            <Download size={16} />
            下载 macOS 安装包
          </button>
        </div>
      )}
      {updateActionError && <p role="alert">{updateActionError}</p>}
      <button
        className="desktop-secondary-action"
        onClick={() => void window.desktop.diagnostics.export()}
      >
        导出脱敏诊断
      </button>
    </section>
  )
}

function updateStatusText(state: UpdaterState): string {
  if (state.status === "manual") return "当前通道或安装来源仅支持手动升级"
  if (state.status === "unsupported") return "当前平台或架构不支持更新"
  if (state.status === "installing") return "正在准备重启安装"
  if (state.status === "downloading") return `正在下载 ${Math.round(state.progress ?? 0)}%`
  if (state.status === "error") {
    return state.errorCode === "platform_signature_required"
      ? "自动安装受 macOS 安全策略限制，请使用安装包手动更新"
      : `更新失败：${state.errorCode ?? "unknown"}`
  }
  if (state.status === "idle") return "当前版本可继续使用"
  return state.status === "checking"
    ? "正在检查"
    : state.status === "downloaded"
      ? "更新已下载"
      : `发现 ${state.targetVersion ?? "新版本"}`
}

function updatePromptLabel(state: UpdaterState): string {
  if (state.status === "downloading") return `下载中 ${Math.round(state.progress ?? 0)}%`
  if (state.status === "downloaded") return "重启更新"
  if (state.status === "installing") return "正在更新"
  if (state.status === "error") return "更新失败"
  return "新版本"
}

function getUpdateInstallErrorMessage(reason: UpdaterInstallResult["reason"]): string {
  if (reason === "install_failed") return "自动安装未能启动，请重试检查或使用手动更新"
  if (reason === "active_transfers") return "仍有文件正在传输，请完成或取消传输后重试"
  if (reason === "install_in_progress") return "更新安装已在进行中"
  if (reason === "not_downloaded") return "更新尚未下载完成，请稍后重试"
  return "更新准备未完成，请稍后重试"
}

function installationSourceLabel(source: UpdaterState["installationSource"]): string {
  const labels: Record<UpdaterState["installationSource"], string> = {
    appimage: "Linux AppImage",
    deb: "Linux deb",
    development: "开发运行",
    mac_app: "macOS 应用",
    nsis: "Windows NSIS",
    unknown: "未知来源",
  }
  return labels[source]
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
