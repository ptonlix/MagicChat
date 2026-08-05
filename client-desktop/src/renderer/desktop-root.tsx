import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SubmitEvent,
} from "react"
import {
  ArrowRight,
  CircleHelp,
  Download,
  LockKeyhole,
  MessageCircleMore,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react"
import { createBrowserRouter, RouterProvider } from "react-router"
import { toast } from "sonner"
import { configureDesktopHost } from "@/lib/desktop-host"
import { RealtimeClient } from "@/lib/realtime-client"
import { ThemeProvider } from "@/components/theme-provider"
import { LocaleProvider, useLocale } from "@/components/locale-provider"
import { DesktopSettingsPanel } from "@/components/settings/desktop-settings-panel"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import App from "@/app/App"
import type { AuthenticatedTarget } from "@shared/client-contract"
import type { ServerProfile, UpdaterState } from "@shared/bridge"
import { DesktopWebSocket, installDesktopFetch } from "./desktop-transport"
import { resolveDesktopResourceUrl } from "@/lib/desktop-resource-url"
import { installDesktopLinkNavigation } from "@/lib/desktop-link-navigation"
import { startRuntimeDiagnostics } from "@/lib/runtime-diagnostics"
import { showScreenshotStartError } from "@/lib/screenshot-start-error"
import { getUpdateInstallErrorMessage, useDesktopUpdateAction } from "@/lib/desktop-updater-ui"
import { BrandLoadingScreen } from "@/components/brand-loading-screen"
import { ExternalLinkConfirmationDialog } from "@/components/external-link-confirmation-dialog"
import { configureMessageCacheTarget } from "@/lib/messages"
import { parseExternalWebLink } from "@shared/external-link"
import { DesktopTargetProvider } from "@/components/desktop-target-provider"

import "./settings-center.css"

export function DesktopRoot() {
  const platform = useDesktopPlatform()

  return (
    <ThemeProvider>
      <LocaleProvider>
        <ScreenshotStartFailedBridge />
        <TooltipProvider>
          <div className="desktop-frame">
            <DesktopTitlebar platform={platform} />
            <div className="desktop-content">
              <DesktopRootContent platform={platform} />
            </div>
          </div>
          <Toaster
            offset={{ top: "calc(var(--desktop-titlebar-height) + 12px)" }}
            position="top-center"
          />
        </TooltipProvider>
      </LocaleProvider>
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

function ScreenshotStartFailedBridge() {
  const { t } = useLocale()
  const latestTRef = useRef(t)
  useEffect(() => {
    latestTRef.current = t
  }, [t])
  useEffect(
    () =>
      window.desktop.screenshot.subscribeStartFailed(({ code }) => {
        // 语言/字号变化只影响文案，不重新订阅宿主事件
        showScreenshotStartError(code, latestTRef.current)
      }),
    [],
  )

  return null
}

function DesktopTitlebar({ platform }: { platform?: string }) {
  const { t } = useLocale()
  return (
    <div className="desktop-titlebar-drag-region">
      {platform && platform !== "darwin" && (
        <div className="desktop-titlebar-brand">
          <img
            alt={platform === "win32" ? "" : t("brand.name")}
            draggable={false}
            src="/logo.png"
          />
          {platform === "win32" && <span>{t("brand.name")}</span>}
        </div>
      )}
    </div>
  )
}

function DesktopRootContent({ platform }: { platform?: string }) {
  const { t } = useLocale()
  const latestTRef = useRef(t)
  useEffect(() => {
    latestTRef.current = t
  }, [t])
  const [profiles, setProfiles] = useState<ReadonlyArray<ServerProfile>>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [messageSoundEnabled, setMessageSoundEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const { setUpdater, updater } = useDesktopUpdaterState()

  useEffect(() => startRuntimeDiagnostics(), [])

  useEffect(() => {
    let active = true
    // 语言/字号变化只影响文案，不重新订阅宿主事件
    void Promise.all([window.desktop.servers.list(), window.desktop.settings.get()]).then(
      ([items, settings]) => {
        if (!active) return
        setProfiles(items)
        setMessageSoundEnabled(settings.messageSoundEnabled)
        setSelectedId(settings.selectedServerId ?? items[0]?.id)
        setLoading(false)
      },
    )
    const unsubscribeUnknownServer = window.desktop.navigation.subscribeUnknownServer(
      ({ serverId }) => {
        window.alert(latestTRef.current("startup.unknownServer", { serverId }))
        setSelectedId(undefined)
      },
    )
    return () => {
      active = false
      unsubscribeUnknownServer()
    }
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
        <StatusPage text={t("startup.starting")} />
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
  const router = useMemo(
    () => createBrowserRouter([{ path: "*", element: <DesktopRoutedWorkspace /> }]),
    [],
  )
  const routerContext = useMemo<DesktopRoutedWorkspaceContextValue>(
    () => ({
      messageSoundEnabled,
      onAuthenticated: setUserId,
      onOpenSettings: openSettings,
      onUpdaterChange,
      profile,
      target,
      updater,
    }),
    [messageSoundEnabled, onUpdaterChange, openSettings, profile, target, updater],
  )

  return (
    <>
      <DesktopRoutedWorkspaceContext.Provider value={routerContext}>
        <RouterProvider router={router} />
      </DesktopRoutedWorkspaceContext.Provider>
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

type DesktopRoutedWorkspaceContextValue = {
  messageSoundEnabled: boolean
  profile: ServerProfile
  target: AuthenticatedTarget
  updater: UpdaterState
  onAuthenticated(userId: string): void
  onOpenSettings(): void
  onUpdaterChange(state: UpdaterState): void
}

const DesktopRoutedWorkspaceContext = createContext<DesktopRoutedWorkspaceContextValue | null>(null)

function DesktopRoutedWorkspace() {
  const value = useContext(DesktopRoutedWorkspaceContext)
  if (!value) throw new Error("Desktop routed workspace context is unavailable")
  return (
    <DesktopTargetProvider target={value.target}>
      <DesktopHostedApp {...value} />
    </DesktopTargetProvider>
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
  const { t } = useLocale()
  const { actionPending, runUpdateAction } = useDesktopUpdateAction(showUpdateActionToast, t)
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
        if (result.status !== "started") toast.error(getUpdateInstallErrorMessage(result.reason, t))
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
  const label = updatePromptLabel(state, t)
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
            title={
              state.targetVersion ? `${label} · ${t("brand.name")} ${state.targetVersion}` : label
            }
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
  const { t } = useLocale()
  const latestTRef = useRef(t)
  useEffect(() => {
    latestTRef.current = t
  }, [t])
  const [ready, setReady] = useState(false)
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string>()
  const messageSoundEnabledRef = useRef(messageSoundEnabled)

  useEffect(() => {
    messageSoundEnabledRef.current = messageSoundEnabled
  }, [messageSoundEnabled])

  useEffect(() => {
    // 语言/字号变化不应重建宿主（fetch/缓存目标/实时连接/订阅）
    const restoreFetch = installDesktopFetch(target)
    const restoreMessageCacheTarget = configureMessageCacheTarget(target)
    const requestExternalLink = async (url: string) => {
      const link = parseExternalWebLink(url)
      if (!link) throw new Error("只允许打开 HTTP 或 HTTPS 外部链接")
      if (link.protocol === "http:") {
        setPendingExternalUrl(link.url)
        return
      }
      await window.desktop.shell.openExternal(link.url)
    }
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
      openExternal: requestExternalLink,
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
      void requestExternalLink(url).catch(() =>
        toast.error(latestTRef.current("startup.openLinkError")),
      )
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

  return (
    <>
      {ready ? (
        <App
          updatePrompt={<DesktopUpdatePrompt state={updater} onStateChange={onUpdaterChange} />}
        />
      ) : (
        <StatusPage detail={profile.displayName} text={t("startup.connecting")} />
      )}
      <ExternalLinkConfirmationDialog
        onConfirm={(url) => {
          setPendingExternalUrl(undefined)
          void window.desktop.shell
            .openExternal(url)
            .catch(() => toast.error(t("startup.openLinkError")))
        }}
        onOpenChange={(open) => {
          if (!open) setPendingExternalUrl(undefined)
        }}
        url={pendingExternalUrl}
      />
    </>
  )
}

function updatePromptLabel(state: UpdaterState, t: ReturnType<typeof useLocale>["t"]): string {
  if (state.status === "downloading") {
    return t("settings.update.prompt.downloading", { percent: Math.round(state.progress ?? 0) })
  }
  if (state.status === "downloaded") return t("settings.update.prompt.downloaded")
  if (state.status === "installing") return t("settings.update.prompt.installing")
  if (state.status === "error") return t("settings.update.prompt.error")
  return t("settings.update.prompt.available")
}

function ServerSetup({ onAdded }: { onAdded(profile: ServerProfile): void }) {
  const { t } = useLocale()
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      onAdded(await window.desktop.servers.add(url, name || undefined))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("setup.addServerError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="server-setup">
      <div className="server-setup-shell">
        <section className="server-setup-hero">
          <div className="server-setup-brand">
            <img alt={t("brand.name")} src="/logo.png" />
            <div>
              <strong>{t("brand.name")}</strong>
              <span>Desktop</span>
            </div>
          </div>

          <div className="server-setup-hero-copy">
            <span className="server-setup-eyebrow">
              <Sparkles size={14} />A BETTER WAY TO WORK
            </span>
            <h1>{t("setup.brandSlogan")}</h1>
            <p>{t("setup.brandDesc")}</p>
          </div>

          <div className="server-setup-benefits">
            <div>
              <span>
                <MessageCircleMore size={17} />
              </span>
              <div>
                <strong>{t("setup.feature.chat.title")}</strong>
                <p>{t("setup.feature.chat.desc")}</p>
              </div>
            </div>
            <div>
              <span>
                <UsersRound size={17} />
              </span>
              <div>
                <strong>{t("setup.feature.team.title")}</strong>
                <p>{t("setup.feature.team.desc")}</p>
              </div>
            </div>
            <div>
              <span>
                <ShieldCheck size={17} />
              </span>
              <div>
                <strong>{t("setup.feature.security.title")}</strong>
                <p>{t("setup.feature.security.desc")}</p>
              </div>
            </div>
          </div>

          <div className="server-setup-hero-footer">
            <span />
            {t("setup.brand")}
          </div>
        </section>

        <section className="server-setup-form-panel">
          <div className="server-setup-form-card">
            <div className="server-setup-form-heading">
              <span>{t("setup.connectWorkspace")}</span>
              <h2>{t("setup.getStarted")}</h2>
              <p>{t("setup.getStarted.desc")}</p>
            </div>

            <form onSubmit={(event) => void submit(event)}>
              <label>
                <span>
                  <strong>{t("setup.serverAddress")}</strong>
                  <small>{t("setup.required")}</small>
                </span>
                <input
                  aria-label={t("setup.serverAddress")}
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
                  <strong>{t("setup.displayName")}</strong>
                  <small>{t("setup.optional")}</small>
                </span>
                <input
                  aria-label={t("setup.displayName")}
                  maxLength={120}
                  placeholder={t("setup.placeholder")}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <button disabled={busy} type="submit">
                <span>{busy ? t("setup.verifying") : t("setup.connect")}</span>
                <ArrowRight size={17} />
              </button>
            </form>

            <div className="server-setup-security">
              <LockKeyhole size={14} />
              <span>{t("setup.trustedOnly")}</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function StatusPage({ detail, text }: { detail?: string; text: string }) {
  const { t } = useLocale()
  return <BrandLoadingScreen detail={detail ?? t("setup.preparingWorkspace")} message={text} />
}
