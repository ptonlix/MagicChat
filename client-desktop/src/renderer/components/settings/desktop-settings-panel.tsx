import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronsUpDown, Download, ExternalLink, RefreshCw, Sparkles, Trash2 } from "lucide-react"

import { useLocale } from "@/components/locale-provider"
import { useTheme } from "@/components/theme-provider"
import { clearManagedMessageCache } from "@/lib/messages"
import {
  getUpdateInstallErrorMessage,
  installationSourceLabel,
  updateStatusText,
  useDesktopUpdateAction,
} from "@/lib/desktop-updater-ui"
import { releaseChannelLabel } from "@/release-channel"
import type { AuthenticatedTarget } from "@shared/client-contract"
import type {
  DesktopAppInfo,
  DesktopFontScale,
  DesktopLanguage,
  DesktopSettings,
  DesktopSettingsPatch,
  ServerProfile,
  UpdaterState,
} from "@shared/bridge"
import type { MessageCacheStats } from "@shared/message-cache-contract"
import { DESKTOP_SETTINGS_CHANGED_EVENT } from "@/hooks/use-desktop-settings"
import { SettingsCenter, type SettingsSectionId } from "./settings-center"
import { SendMessageShortcutPicker } from "./send-message-shortcut-picker"
import { ShortcutRecorder } from "./shortcut-recorder"
import { DEFAULT_SCREENSHOT_SHORTCUT, DEFAULT_SEARCH_SHORTCUT } from "@shared/shortcut-contract"

export function DesktopSettingsPanel({
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
  const { t } = useLocale()
  const { setTheme, theme } = useTheme()
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general")
  const [settings, setSettings] = useState<DesktopSettings>()
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsLoadError, setSettingsLoadError] = useState("")
  const [appInfo, setAppInfo] = useState<DesktopAppInfo>()
  const [name, setName] = useState(profile.displayName)
  const [busy, setBusy] = useState(false)
  const [renameError, setRenameError] = useState("")
  const [removeError, setRemoveError] = useState("")
  const [settingsError, setSettingsError] = useState("")
  const [cacheStats, setCacheStats] = useState<MessageCacheStats>()
  const [cacheClearing, setCacheClearing] = useState(false)
  const loadGenerationRef = useRef(0)

  const loadSettings = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    setSettingsLoading(true)
    setSettingsLoadError("")
    try {
      const [nextSettings, nextInfo, nextCacheStats] = await Promise.all([
        window.desktop.settings.get(),
        window.desktop.app.info(),
        window.desktop.messageCache.getStats(target).catch(() => undefined),
      ])
      if (generation !== loadGenerationRef.current) return
      setSettings(nextSettings)
      setAppInfo(nextInfo)
      setCacheStats(nextCacheStats)
    } catch {
      if (generation === loadGenerationRef.current) {
        setSettingsLoadError(t("settings.loadError"))
      }
    } finally {
      if (generation === loadGenerationRef.current) setSettingsLoading(false)
    }
  }, [t, target])

  useEffect(() => {
    void loadSettings()
    return () => {
      loadGenerationRef.current += 1
    }
  }, [loadSettings])

  async function clearMessageCache() {
    if (!window.confirm(t("settings.storage.confirm"))) return
    setCacheClearing(true)
    setSettingsError("")
    try {
      const managed = await clearManagedMessageCache(target)
      if (!managed) await window.desktop.messageCache.clearUser(target)
      setCacheStats(await window.desktop.messageCache.getStats(target))
    } catch {
      setSettingsError(t("settings.storage.error"))
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
      window.dispatchEvent(new Event(DESKTOP_SETTINGS_CHANGED_EVENT))
    } catch {
      setSettingsError(t("settings.saveError"))
    }
  }

  async function renameServer() {
    setBusy(true)
    setRenameError("")
    try {
      await window.desktop.servers.rename(profile.id, name)
      window.location.reload()
    } catch {
      setRenameError(t("settings.workspace.error.rename"))
    } finally {
      setBusy(false)
    }
  }

  async function removeServer() {
    if (!window.confirm(t("settings.workspace.remove.confirm", { name: profile.displayName })))
      return
    setBusy(true)
    setRemoveError("")
    try {
      await window.desktop.servers.remove(profile.id)
      onOpenChange(false)
      onRemoved(profile.id)
    } catch (reason) {
      setRemoveError(
        reason instanceof Error ? reason.message : t("settings.workspace.error.remove"),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCenter
      activeSection={activeSection}
      appInfo={appInfo}
      platform={platform}
      profile={profile}
      onOpenChange={onOpenChange}
      onSectionChange={setActiveSection}
    >
      {settingsLoading && !settings ? (
        <div className="settings-center-loading">
          <Sparkles aria-hidden="true" size={18} />
          <span>{t("settings.loading")}</span>
        </div>
      ) : !settings ? (
        <div className="settings-center-load-error" role="alert">
          <strong>{settingsLoadError || t("settings.loadError")}</strong>
          <button onClick={() => void loadSettings()} type="button">
            {t("settings.loadRetry")}
          </button>
        </div>
      ) : (
        <div className="settings-center-page">
          {settingsError && <p role="alert">{settingsError}</p>}

          {activeSection === "general" && (
            <section aria-labelledby="settings-general-title" className="settings-group">
              <h3 id="settings-general-title">{t("settings.general.title")}</h3>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.general.autoLaunch")}</strong>
                  <small>{t("settings.general.autoLaunch.desc")}</small>
                </span>
                <input
                  checked={settings.autoLaunch}
                  type="checkbox"
                  onChange={(event) => void updateSettings({ autoLaunch: event.target.checked })}
                />
              </label>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.general.closeBehavior")}</strong>
                  <small>{t("settings.general.closeBehavior.desc")}</small>
                </span>
                <select
                  value={settings.closeBehavior}
                  onChange={(event) =>
                    void updateSettings({
                      closeBehavior: event.target.value as DesktopSettings["closeBehavior"],
                    })
                  }
                >
                  <option value="background">
                    {t("settings.general.closeBehavior.background")}
                  </option>
                  <option value="quit">{t("settings.general.closeBehavior.quit")}</option>
                </select>
              </label>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.general.language")}</strong>
                  <small>{t("settings.general.language.desc")}</small>
                </span>
                <select
                  aria-label={t("settings.general.language")}
                  value={settings.language}
                  onChange={(event) =>
                    void updateSettings({ language: event.target.value as DesktopLanguage })
                  }
                >
                  <option value="zh-CN">{t("settings.general.language.zhCN")}</option>
                  <option value="en">{t("settings.general.language.en")}</option>
                </select>
              </label>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.general.fontScale")}</strong>
                  <small>{t("settings.general.fontScale.desc")}</small>
                </span>
                <select
                  aria-label={t("settings.general.fontScale")}
                  value={settings.fontScale}
                  onChange={(event) =>
                    void updateSettings({ fontScale: event.target.value as DesktopFontScale })
                  }
                >
                  <option value="normal">{t("settings.general.fontScale.normal")}</option>
                  <option value="medium">{t("settings.general.fontScale.medium")}</option>
                  <option value="large">{t("settings.general.fontScale.large")}</option>
                </select>
              </label>
            </section>
          )}

          {activeSection === "notifications" && (
            <section aria-labelledby="settings-notifications-title" className="settings-group">
              <h3 id="settings-notifications-title">{t("settings.notifications.title")}</h3>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.notifications.sound")}</strong>
                  <small>{t("settings.notifications.sound.desc")}</small>
                </span>
                <input
                  aria-label={t("settings.notifications.sound")}
                  checked={settings.messageSoundEnabled}
                  type="checkbox"
                  onChange={(event) =>
                    void updateSettings({ messageSoundEnabled: event.target.checked })
                  }
                />
              </label>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.notifications.privacy")}</strong>
                  <small>{t("settings.notifications.privacy.desc")}</small>
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
                  <option value="hidden">{t("settings.notifications.privacy.hidden")}</option>
                  <option value="metadata">{t("settings.notifications.privacy.metadata")}</option>
                  <option value="preview">{t("settings.notifications.privacy.preview")}</option>
                </select>
              </label>
            </section>
          )}

          {activeSection === "appearance" && (
            <section aria-labelledby="settings-appearance-title" className="settings-group">
              <div className="settings-appearance-row">
                <h3 id="settings-appearance-title">{t("settings.appearance.title")}</h3>
                <div className="settings-appearance-select">
                  <select
                    aria-labelledby="settings-appearance-title"
                    value={theme}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value === "system" || value === "light" || value === "dark") {
                        setTheme(value)
                      }
                    }}
                  >
                    <option value="system">{t("settings.appearance.system")}</option>
                    <option value="light">{t("settings.appearance.light")}</option>
                    <option value="dark">{t("settings.appearance.dark")}</option>
                  </select>
                  <span aria-hidden="true" className="settings-appearance-select-icon">
                    <ChevronsUpDown size={16} strokeWidth={2.4} />
                  </span>
                </div>
              </div>
            </section>
          )}

          {activeSection === "storage" && (
            <section aria-labelledby="settings-storage-title" className="settings-group">
              <h3 id="settings-storage-title">{t("settings.storage.title")}</h3>
              <div className="settings-row">
                <span>
                  <strong>{formatCacheSize(cacheStats?.payloadBytes ?? 0)}</strong>
                  <small>{cacheStatusText(cacheStats?.status, t)}</small>
                </span>
                <button
                  aria-label={t("settings.storage.clear.aria")}
                  className="settings-secondary-button"
                  disabled={cacheClearing}
                  onClick={() => void clearMessageCache()}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {t("settings.storage.clear")}
                </button>
              </div>
            </section>
          )}

          {activeSection === "shortcuts" && (
            <section aria-labelledby="settings-shortcuts-title" className="settings-group">
              <h3 id="settings-shortcuts-title">{t("settings.shortcuts.title")}</h3>
              <div className="settings-row">
                <span>
                  <strong>{t("settings.shortcuts.search")}</strong>
                  <small>{t("settings.shortcuts.search.desc")}</small>
                </span>
                <ShortcutRecorder
                  defaultAccelerator={DEFAULT_SEARCH_SHORTCUT}
                  kind="search"
                  labelKey="settings.shortcuts.search.aria"
                  platform={platform ?? "unknown"}
                />
              </div>
              <div className="settings-row">
                <span>
                  <strong>{t("settings.shortcuts.sendMessage")}</strong>
                  <small>{t("settings.shortcuts.sendMessage.desc")}</small>
                </span>
                <SendMessageShortcutPicker platform={platform ?? "unknown"} />
              </div>
              <div className="settings-row">
                <span>
                  <strong>{t("settings.shortcuts.screenshot")}</strong>
                  <small>{t("settings.shortcuts.screenshot.desc")}</small>
                </span>
                <ShortcutRecorder
                  defaultAccelerator={DEFAULT_SCREENSHOT_SHORTCUT}
                  kind="screenshot"
                  labelKey="settings.shortcuts.screenshot.aria"
                  platform={platform ?? "unknown"}
                />
              </div>
            </section>
          )}

          {activeSection === "updates" && (
            <DesktopUpdateSettingsSection
              state={updater}
              onClose={() => onOpenChange(false)}
              onStateChange={onUpdaterChange}
            />
          )}

          {activeSection === "workspace" && (
            <section aria-labelledby="settings-workspace-title" className="settings-group">
              <h3 id="settings-workspace-title">{t("settings.workspace.title")}</h3>
              <label className="settings-row settings-row-stack">
                <span>
                  <strong>{t("settings.workspace.displayName")}</strong>
                  <small>{t("settings.workspace.displayName.desc")}</small>
                </span>
                <div className="settings-inline-form">
                  <input
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button
                    disabled={busy || !name.trim() || name.trim() === profile.displayName}
                    onClick={() => void renameServer()}
                    type="button"
                  >
                    {t("settings.workspace.save")}
                  </button>
                </div>
                {renameError && <small className="settings-field-error">{renameError}</small>}
              </label>
              <div className="settings-row settings-server-row">
                <span>
                  <strong>{t("settings.workspace.server")}</strong>
                  <small>
                    <code>{profile.normalizedUrl}</code>
                  </small>
                </span>
                <button
                  className="settings-danger-button"
                  disabled={busy}
                  onClick={() => void removeServer()}
                  type="button"
                >
                  {t("settings.workspace.remove")}
                </button>
              </div>
              {removeError && <p role="alert">{removeError}</p>}
            </section>
          )}

          {activeSection === "about" && (
            <section aria-labelledby="settings-about-title" className="settings-group">
              <h3 id="settings-about-title">{t("settings.about.title")}</h3>
              <div className="settings-about-brand">
                <img alt={t("brand.name")} src="/logo.png" />
                <div>
                  <strong>{t("brand.name")}</strong>
                  <span>
                    {appInfo
                      ? `${appInfo.version} · ${appInfo.platform} ${appInfo.arch}`
                      : t("settings.about.version.loading")}
                  </span>
                  {appInfo && (
                    <small>
                      {releaseChannelLabel(appInfo.channel, t)} · {t("settings.about.build")}{" "}
                      {appInfo.build}
                    </small>
                  )}
                </div>
              </div>
              <button
                className="settings-secondary-button settings-diagnostics-button"
                onClick={() => void window.desktop.diagnostics.export()}
                type="button"
              >
                {t("settings.about.export")}
              </button>
            </section>
          )}
        </div>
      )}
    </SettingsCenter>
  )
}

function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function cacheStatusText(
  status: MessageCacheStats["status"] | undefined,
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (status === "available") return t("settings.storage.status.available")
  if (status === "rebuilding") return t("settings.storage.status.rebuilding")
  if (status === "degraded") return t("settings.storage.status.degraded")
  return t("settings.storage.status.loading")
}

function DesktopUpdateSettingsSection({
  onClose,
  onStateChange,
  state,
}: {
  onClose(): void
  onStateChange(state: UpdaterState): void
  state: UpdaterState
}) {
  const { t } = useLocale()
  const [updateActionError, setUpdateActionError] = useState("")
  const { actionPending, runUpdateAction } = useDesktopUpdateAction(setUpdateActionError, t)
  const showMacManualUpdate =
    state.installationSource === "mac_app" &&
    Boolean(state.targetVersion) &&
    (state.status === "available" || state.status === "error")
  const manualDownloadLabel = showMacManualUpdate
    ? t("settings.update.manualDownload")
    : state.installMode === "manual" && (state.status === "available" || state.status === "manual")
      ? (state.manualAction?.label ?? t("settings.update.download"))
      : undefined

  function runSettingsUpdateAction(action: () => Promise<void>) {
    setUpdateActionError("")
    void runUpdateAction(action)
  }

  return (
    <section aria-labelledby="settings-updates-title" className="settings-group">
      <h3 id="settings-updates-title">{t("settings.update.title")}</h3>
      <div className="settings-row settings-update-status">
        <span>
          <strong>
            {t("settings.update.current", {
              version: state.currentVersion || t("settings.update.current.loading"),
            })}
          </strong>
          <small>{updateStatusText(state, t)}</small>
          {state.targetVersion && (
            <small>{t("settings.update.target", { version: state.targetVersion })}</small>
          )}
          <small>
            {t("settings.update.source", {
              label: installationSourceLabel(state.installationSource, t),
            })}
          </small>
        </span>
        <div className="settings-update-actions">
          {manualDownloadLabel && (
            <button
              className="settings-secondary-button"
              disabled={actionPending}
              onClick={() =>
                runSettingsUpdateAction(async () => {
                  await window.desktop.updater.openManualDownload()
                })
              }
              type="button"
            >
              <Download aria-hidden="true" size={16} />
              {manualDownloadLabel}
            </button>
          )}
          <button
            aria-label={t("settings.update.check")}
            className="settings-secondary-button"
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
            title={t("settings.update.check")}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            {t("settings.update.check")}
          </button>
        </div>
      </div>
      {state.targetVersion && (
        <button
          className="settings-release-link"
          disabled={actionPending}
          onClick={() =>
            runSettingsUpdateAction(async () => {
              await window.desktop.updater.openReleasePage()
            })
          }
          type="button"
        >
          <ExternalLink aria-hidden="true" size={15} />
          {t("settings.update.release")}
        </button>
      )}
      {state.status === "available" && state.installMode === "ota" && (
        <button
          className="settings-primary-button"
          disabled={actionPending || !state.retryable}
          onClick={() =>
            runSettingsUpdateAction(async () => {
              await window.desktop.updater.download()
            })
          }
          type="button"
        >
          <Download aria-hidden="true" size={16} />
          {state.installationSource === "mac_app"
            ? t("settings.update.downloadAuto")
            : t("settings.update.download")}
        </button>
      )}
      {state.status === "downloaded" && (
        <div className="grid grid-cols-2 gap-2">
          <button className="settings-secondary-button" onClick={onClose} type="button">
            {t("settings.update.later")}
          </button>
          <button
            className="settings-primary-button"
            disabled={actionPending}
            onClick={() =>
              runSettingsUpdateAction(async () => {
                const result = await window.desktop.updater.install()
                if (result.status === "started") return
                setUpdateActionError(getUpdateInstallErrorMessage(result.reason, t))
              })
            }
            type="button"
          >
            <Sparkles aria-hidden="true" size={16} />
            {t("settings.update.install")}
          </button>
        </div>
      )}
      {state.status === "error" && state.retryable && (
        <button
          className="settings-primary-button"
          disabled={actionPending}
          onClick={() =>
            runSettingsUpdateAction(async () => {
              onStateChange(await window.desktop.updater.check())
            })
          }
          type="button"
        >
          {t("settings.update.retry")}
        </button>
      )}
      {showMacManualUpdate && (
        <div className="desktop-mac-update-guide">
          <strong>{t("settings.update.mac.title")}</strong>
          <p>{t("settings.update.mac.desc")}</p>
          <ol>
            <li>{t("settings.update.mac.step1")}</li>
            <li>{t("settings.update.mac.step2")}</li>
            <li>{t("settings.update.mac.step3")}</li>
          </ol>
        </div>
      )}
      {updateActionError && <p role="alert">{updateActionError}</p>}
    </section>
  )
}
