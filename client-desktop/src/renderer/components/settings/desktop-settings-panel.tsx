import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, Download, ExternalLink, RefreshCw, Sparkles, Trash2 } from "lucide-react"

import { useLocale } from "@/components/locale-provider"
import { isTheme, useTheme } from "@/components/theme-provider"
import type { TranslationKey } from "@/lib/i18n"
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
import type { DiagnosticStorageStats } from "@shared/diagnostics-contract"
import type { MessageCacheStats } from "@shared/message-cache-contract"
import {
  storageCacheKinds,
  type DesktopStorageStats,
  type StorageCacheKind,
} from "@shared/storage-contract"
import { DESKTOP_SETTINGS_CHANGED_EVENT } from "@/hooks/use-desktop-settings"
import { SettingsCenter, type SettingsSectionId } from "./settings-center"
import { SendMessageShortcutPicker } from "./send-message-shortcut-picker"
import { ShortcutRecorder } from "./shortcut-recorder"
import { DEFAULT_SCREENSHOT_SHORTCUT, DEFAULT_SEARCH_SHORTCUT } from "@shared/shortcut-contract"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const appearanceOptions = [
  { value: "system", label: "settings.appearance.system" },
  { value: "light", label: "settings.appearance.light" },
  { value: "dark", label: "settings.appearance.dark" },
  { value: "blue", label: "settings.appearance.blue" },
  { value: "violet", label: "settings.appearance.violet" },
  { value: "rose", label: "settings.appearance.rose" },
  { value: "amber", label: "settings.appearance.amber" },
  { value: "emerald", label: "settings.appearance.emerald" },
] as const satisfies ReadonlyArray<{
  label: TranslationKey
  value: string
}>

function SettingsSelect({
  ariaLabel,
  disabled = false,
  onValueChange,
  options,
  value,
}: {
  ariaLabel: string
  disabled?: boolean
  onValueChange(value: string): void
  options: ReadonlyArray<Readonly<{ label: TranslationKey; value: string }>>
  value: string
}) {
  const { t } = useLocale()

  return (
    <Select disabled={disabled} value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className="settings-select-trigger">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="settings-select-content" position="popper">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {t(option.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function DesktopSettingsPanel({
  platform,
  profile,
  target,
  updater,
  onMessageSoundEnabledChange,
  onMessageNotificationsEnabledChange,
  onOpenChange,
  onRemoved,
  onUpdaterChange,
}: {
  platform?: string
  profile: ServerProfile
  target: AuthenticatedTarget
  updater: UpdaterState
  onMessageSoundEnabledChange(enabled: boolean): void
  onMessageNotificationsEnabledChange(enabled: boolean): void
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
  const [cacheClearError, setCacheClearError] = useState("")
  const [diagnosticStats, setDiagnosticStats] = useState<DiagnosticStorageStats>()
  const [diagnosticsClearing, setDiagnosticsClearing] = useState(false)
  const [diagnosticsClearError, setDiagnosticsClearError] = useState("")
  const [storageStats, setStorageStats] = useState<DesktopStorageStats>()
  const [selectedCacheKinds, setSelectedCacheKinds] = useState<ReadonlyArray<StorageCacheKind>>([])
  const [storageCacheClearing, setStorageCacheClearing] = useState(false)
  const [storageCacheClearError, setStorageCacheClearError] = useState("")
  const [storageCacheClearSuccess, setStorageCacheClearSuccess] = useState("")
  const loadGenerationRef = useRef(0)

  const loadSettings = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    setSettingsLoading(true)
    setSettingsLoadError("")
    try {
      const [nextSettings, nextInfo, nextCacheStats, nextDiagnosticStats, nextStorageStats] =
        await Promise.all([
          window.desktop.settings.get(),
          window.desktop.app.info(),
          window.desktop.messageCache.getStats(target).catch(() => undefined),
          window.desktop.diagnostics.getStorageStats().catch(() => undefined),
          window.desktop.storage.getStats().catch(() => undefined),
        ])
      if (generation !== loadGenerationRef.current) return
      setSettings(nextSettings)
      setAppInfo(nextInfo)
      setCacheStats(nextCacheStats)
      setDiagnosticStats(nextDiagnosticStats)
      setStorageStats(nextStorageStats)
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

  useEffect(() => {
    setSelectedCacheKinds((current) =>
      current.filter((kind) =>
        storageStats?.cacheItems.some(
          (item) => item.kind === kind && item.clearable && item.bytes > 0,
        ),
      ),
    )
  }, [storageStats])

  async function refreshStorageStats(): Promise<void> {
    const nextStorageStats = await window.desktop.storage.getStats().catch(() => undefined)
    if (nextStorageStats) setStorageStats(nextStorageStats)
  }

  async function clearMessageCache() {
    if (!window.confirm(t("settings.storage.confirm"))) return
    setCacheClearing(true)
    setCacheClearError("")
    try {
      const managed = await clearManagedMessageCache(target)
      if (!managed) await window.desktop.messageCache.clearUser(target)
      setCacheStats(await window.desktop.messageCache.getStats(target))
      await refreshStorageStats()
    } catch {
      setCacheClearError(t("settings.storage.error"))
    } finally {
      setCacheClearing(false)
    }
  }

  async function clearDiagnosticsStorage() {
    if (!window.confirm(t("settings.storage.diagnostics.confirm"))) return
    setDiagnosticsClearing(true)
    setDiagnosticsClearError("")
    try {
      setDiagnosticStats(await window.desktop.diagnostics.clearStorage())
      await refreshStorageStats()
    } catch {
      setDiagnosticsClearError(t("settings.storage.diagnostics.error"))
      setDiagnosticStats(await window.desktop.diagnostics.getStorageStats().catch(() => undefined))
    } finally {
      setDiagnosticsClearing(false)
    }
  }

  function toggleCacheKind(kind: StorageCacheKind, checked: boolean) {
    setSelectedCacheKinds((current) => {
      if (checked) return [...new Set([...current, kind])]
      return current.filter((item) => item !== kind)
    })
    setStorageCacheClearError("")
    setStorageCacheClearSuccess("")
  }

  async function clearSelectedStorageCache() {
    const selectedItems = (storageStats?.cacheItems ?? []).filter(
      (item) => item.clearable && selectedCacheKinds.includes(item.kind),
    )
    if (selectedItems.length === 0) return

    const expectedBytes = selectedItems.reduce((total, item) => total + item.bytes, 0)
    const itemNames = selectedItems.map((item) => storageCacheKindLabel(item.kind, t)).join("、")
    if (
      !window.confirm(
        t("settings.storage.cacheData.confirm", {
          items: itemNames,
          size: formatStorageBytes(expectedBytes),
        }),
      )
    )
      return

    setStorageCacheClearing(true)
    setStorageCacheClearError("")
    setStorageCacheClearSuccess("")
    try {
      const result = await window.desktop.storage.clearCache(selectedItems.map((item) => item.kind))
      setStorageStats(result.stats)
      setSelectedCacheKinds([])
      setStorageCacheClearSuccess(
        t("settings.storage.cacheData.success", {
          size: formatStorageBytes(result.reclaimedBytes),
        }),
      )
    } catch {
      setStorageCacheClearError(t("settings.storage.cacheData.error"))
      await refreshStorageStats()
    } finally {
      setStorageCacheClearing(false)
    }
  }

  const selectedCacheItems = (storageStats?.cacheItems ?? []).filter(
    (item) => item.clearable && item.bytes > 0 && selectedCacheKinds.includes(item.kind),
  )
  const selectedCacheBytes = selectedCacheItems.reduce((total, item) => total + item.bytes, 0)

  async function updateSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings | undefined> {
    setSettingsError("")
    try {
      const nextSettings = await window.desktop.settings.set(patch)
      setSettings(nextSettings)
      if (patch.messageSoundEnabled !== undefined) {
        onMessageSoundEnabledChange(nextSettings.messageSoundEnabled)
      }
      if (patch.messageNotificationsEnabled !== undefined) {
        onMessageNotificationsEnabledChange(nextSettings.messageNotificationsEnabled)
      }
      window.dispatchEvent(new Event(DESKTOP_SETTINGS_CHANGED_EVENT))
      return nextSettings
    } catch {
      setSettingsError(t("settings.saveError"))
      return undefined
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
      const removed = await window.desktop.servers.remove(profile.id)
      if (!removed) return
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
            <section aria-label={t("settings.general.title")} className="settings-group">
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
                <SettingsSelect
                  ariaLabel={t("settings.general.closeBehavior")}
                  options={[
                    {
                      label: "settings.general.closeBehavior.background",
                      value: "background",
                    },
                    { label: "settings.general.closeBehavior.quit", value: "quit" },
                  ]}
                  value={settings.closeBehavior}
                  onValueChange={(value) =>
                    void updateSettings({
                      closeBehavior: value as DesktopSettings["closeBehavior"],
                    })
                  }
                />
              </label>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.general.language")}</strong>
                  <small>{t("settings.general.language.desc")}</small>
                </span>
                <SettingsSelect
                  ariaLabel={t("settings.general.language")}
                  options={[
                    { label: "settings.general.language.zhCN", value: "zh-CN" },
                    { label: "settings.general.language.en", value: "en" },
                  ]}
                  value={settings.language}
                  onValueChange={(value) =>
                    void updateSettings({ language: value as DesktopLanguage })
                  }
                />
              </label>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.general.fontScale")}</strong>
                  <small>{t("settings.general.fontScale.desc")}</small>
                </span>
                <SettingsSelect
                  ariaLabel={t("settings.general.fontScale")}
                  options={[
                    { label: "settings.general.fontScale.normal", value: "normal" },
                    { label: "settings.general.fontScale.medium", value: "medium" },
                    { label: "settings.general.fontScale.large", value: "large" },
                  ]}
                  value={settings.fontScale}
                  onValueChange={(value) =>
                    void updateSettings({ fontScale: value as DesktopFontScale })
                  }
                />
              </label>
            </section>
          )}

          {activeSection === "notifications" && (
            <section aria-label={t("settings.notifications.title")} className="settings-group">
              <label className="settings-row">
                <span>
                  <strong>{t("settings.notifications.enabled")}</strong>
                  <small>{t("settings.notifications.enabled.desc")}</small>
                </span>
                <input
                  aria-label={t("settings.notifications.enabled")}
                  checked={settings.messageNotificationsEnabled}
                  type="checkbox"
                  onChange={(event) =>
                    void updateSettings({
                      messageNotificationsEnabled: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="settings-row">
                <span>
                  <strong>{t("settings.notifications.sound")}</strong>
                  <small>{t("settings.notifications.sound.desc")}</small>
                </span>
                <input
                  aria-label={t("settings.notifications.sound")}
                  checked={settings.messageSoundEnabled}
                  disabled={!settings.messageNotificationsEnabled}
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
                <SettingsSelect
                  ariaLabel={t("settings.notifications.privacy")}
                  disabled={!settings.messageNotificationsEnabled}
                  options={[
                    { label: "settings.notifications.privacy.hidden", value: "hidden" },
                    {
                      label: "settings.notifications.privacy.metadata",
                      value: "metadata",
                    },
                    { label: "settings.notifications.privacy.preview", value: "preview" },
                  ]}
                  value={settings.notificationPrivacy}
                  onValueChange={(value) =>
                    void updateSettings({
                      notificationPrivacy: value as DesktopSettings["notificationPrivacy"],
                    })
                  }
                />
              </label>
            </section>
          )}

          {activeSection === "appearance" && (
            <section aria-label={t("settings.appearance.title")} className="settings-group">
              <div className="settings-appearance-row">
                <strong>{t("settings.appearance.colorScheme")}</strong>
                <SettingsSelect
                  ariaLabel={t("settings.appearance.title")}
                  options={appearanceOptions}
                  value={theme}
                  onValueChange={(value) => {
                    if (isTheme(value)) setTheme(value)
                  }}
                />
              </div>
            </section>
          )}

          {activeSection === "storage" && (
            <section aria-label={t("settings.storage.title")} className="settings-group">
              <StorageDiskOverview stats={storageStats} />
              <details className="settings-storage-cache" open>
                <summary>
                  <span>
                    <strong>{t("settings.storage.cacheData.title")}</strong>
                    <small>{t("settings.storage.cacheData.desc")}</small>
                  </span>
                  <span className="settings-storage-cache-summary-end">
                    <small className="settings-storage-cache-total">
                      {formatStorageBytes(
                        (storageStats?.cacheItems ?? []).reduce(
                          (total, item) => total + item.bytes,
                          0,
                        ),
                      )}
                    </small>
                    <ChevronDown aria-hidden="true" size={16} />
                  </span>
                </summary>
                <div className="settings-storage-cache-items">
                  {storageCacheKinds.map((kind) => {
                    const item = storageStats?.cacheItems.find(
                      (candidate) => candidate.kind === kind,
                    )
                    const clearable = Boolean(item?.clearable)
                    const selectable = clearable && (item?.bytes ?? 0) > 0
                    return (
                      <label className="settings-storage-cache-item" key={kind}>
                        <input
                          aria-label={storageCacheKindLabel(kind, t)}
                          checked={selectedCacheKinds.includes(kind)}
                          disabled={!selectable || storageCacheClearing}
                          type="checkbox"
                          onChange={(event) => toggleCacheKind(kind, event.target.checked)}
                        />
                        <span>
                          <strong>{storageCacheKindLabel(kind, t)}</strong>
                          <small>
                            {item
                              ? formatStorageBytes(item.bytes)
                              : t("settings.storage.cacheData.loading")}
                            {!clearable && item && kind === "updates" && (
                              <>
                                {" · "}
                                {t("settings.storage.cacheData.updates.unavailable")}
                              </>
                            )}
                          </small>
                        </span>
                      </label>
                    )
                  })}
                </div>
                <div className="settings-storage-cache-actions">
                  <small>
                    {t("settings.storage.cacheData.selected", {
                      count: selectedCacheItems.length,
                      size: formatStorageBytes(selectedCacheBytes),
                    })}
                  </small>
                  <button
                    aria-label={t("settings.storage.cacheData.clear.aria")}
                    className="settings-secondary-button"
                    disabled={storageCacheClearing || selectedCacheItems.length === 0}
                    onClick={() => void clearSelectedStorageCache()}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                    {t("settings.storage.cacheData.clear")}
                  </button>
                </div>
                {storageCacheClearError && <p role="alert">{storageCacheClearError}</p>}
                {storageCacheClearSuccess && (
                  <p className="settings-storage-success" role="status">
                    {storageCacheClearSuccess}
                  </p>
                )}
              </details>
              <div className="settings-row">
                <span>
                  <strong>{t("settings.storage.cache.title")}</strong>
                  <small>
                    {formatStorageBytes(
                      storageStats?.messageCacheBytes ?? cacheStats?.payloadBytes ?? 0,
                    )}
                    {" · "}
                    {cacheStatusText(cacheStats?.status, t)}
                  </small>
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
              {cacheClearError && <p role="alert">{cacheClearError}</p>}
              <div className="settings-row settings-storage-other">
                <span>
                  <strong>{t("settings.storage.other.title")}</strong>
                  <small>
                    {formatStorageBytes(storageStats?.otherBytes ?? 0)} ·{" "}
                    {t("settings.storage.other.desc")}
                  </small>
                </span>
              </div>
              <div className="settings-row">
                <span>
                  <strong>{t("settings.storage.diagnostics.title")}</strong>
                  <small>
                    {diagnosticStats?.status === "available"
                      ? formatStorageBytes(storageStats?.diagnosticsBytes ?? diagnosticStats.bytes)
                      : t("settings.storage.diagnostics.size.unavailable")}
                    {diagnosticStats?.status !== "available" && (
                      <>
                        {" · "}
                        {diagnosticStorageStatusText(diagnosticStats?.status, t)}
                      </>
                    )}
                  </small>
                </span>
                <button
                  aria-label={t("settings.storage.diagnostics.clear.aria")}
                  className="settings-secondary-button"
                  disabled={diagnosticsClearing || diagnosticStats?.status !== "available"}
                  onClick={() => void clearDiagnosticsStorage()}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {t("settings.storage.diagnostics.clear")}
                </button>
              </div>
              {diagnosticsClearError && <p role="alert">{diagnosticsClearError}</p>}
            </section>
          )}

          {activeSection === "shortcuts" && (
            <section aria-label={t("settings.shortcuts.title")} className="settings-group">
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
            <section aria-label={t("settings.workspace.title")} className="settings-group">
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
            <section aria-label={t("settings.about.title")} className="settings-group">
              <div className="settings-about-brand">
                <img alt={t("brand.name")} src="/logo.png" />
                <div>
                  <strong>{t("brand.name")}</strong>
                  <span>
                    {appInfo
                      ? `${appInfo.version} · ${appInfo.platform} ${appInfo.arch}`
                      : t("settings.about.version.loading")}
                  </span>
                  {appInfo && <small>{releaseChannelLabel(appInfo.channel, t)}</small>}
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

function StorageDiskOverview({ stats }: { stats?: DesktopStorageStats }) {
  const { t } = useLocale()
  const disk = stats?.disk
  const diskAvailable = disk?.availableBytes ?? 0
  const diskUsed = disk?.usedBytes ?? 0
  const diskTotal = disk?.totalBytes ?? 0
  const appBytes = Math.min(stats?.appBytes ?? 0, diskUsed)
  const otherUsedBytes = Math.max(0, diskUsed - appBytes)
  const percentages = diskTotal
    ? {
        app: (appBytes / diskTotal) * 100,
        available: (diskAvailable / diskTotal) * 100,
        other: (otherUsedBytes / diskTotal) * 100,
      }
    : { app: 0, available: 0, other: 0 }

  return (
    <div className="settings-storage-overview">
      <div className="settings-storage-overview-heading">
        <span>
          <strong>{t("settings.storage.disk.title")}</strong>
          <small>
            {diskTotal
              ? t("settings.storage.disk.summary", {
                  available: formatStorageBytes(diskAvailable),
                  used: formatStorageBytes(diskUsed),
                })
              : t("settings.storage.disk.loading")}
          </small>
        </span>
        {diskTotal > 0 && <small>{formatStorageBytes(diskTotal)}</small>}
      </div>
      <div
        aria-label={
          diskTotal
            ? t("settings.storage.disk.aria", {
                app: formatStorageBytes(appBytes),
                available: formatStorageBytes(diskAvailable),
                used: formatStorageBytes(diskUsed),
              })
            : t("settings.storage.disk.loading")
        }
        className="settings-storage-disk-bar"
        role="img"
      >
        <span
          aria-hidden="true"
          className="settings-storage-disk-segment settings-storage-disk-segment-app"
          style={{ width: `${percentages.app}%` }}
        />
        <span
          aria-hidden="true"
          className="settings-storage-disk-segment settings-storage-disk-segment-other"
          style={{ width: `${percentages.other}%` }}
        />
        <span
          aria-hidden="true"
          className="settings-storage-disk-segment settings-storage-disk-segment-available"
          style={{ width: `${percentages.available}%` }}
        />
      </div>
      <div className="settings-storage-disk-legend">
        <span>
          <i aria-hidden="true" className="settings-storage-disk-marker-app" />
          <small>{t("settings.storage.disk.app")}</small>
          <strong>{formatStorageBytes(appBytes)}</strong>
        </span>
        <span>
          <i aria-hidden="true" className="settings-storage-disk-marker-other" />
          <small>{t("settings.storage.disk.other")}</small>
          <strong>{formatStorageBytes(otherUsedBytes)}</strong>
        </span>
        <span>
          <i aria-hidden="true" className="settings-storage-disk-marker-available" />
          <small>{t("settings.storage.disk.available")}</small>
          <strong>{formatStorageBytes(diskAvailable)}</strong>
        </span>
      </div>
    </div>
  )
}

function storageCacheKindLabel(
  kind: StorageCacheKind,
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (kind === "network") return t("settings.storage.cacheData.network")
  if (kind === "runtime") return t("settings.storage.cacheData.runtime")
  return t("settings.storage.cacheData.updates")
}

function formatStorageBytes(bytes: number): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`
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

function diagnosticStorageStatusText(
  status: DiagnosticStorageStats["status"] | undefined,
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (status === "unavailable") return t("settings.storage.diagnostics.status.unavailable")
  return t("settings.storage.diagnostics.status.loading")
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
    <section aria-label={t("settings.update.title")} className="settings-group">
      <div className="settings-row settings-update-status">
        <span>
          <strong>
            {t("settings.update.current", {
              version: state.currentVersion || t("settings.update.current.loading"),
            })}
          </strong>
          <small>{updateStatusText(state, t)}</small>
          {state.targetVersion && (
            <span className="settings-update-target">
              <small>{t("settings.update.target", { version: state.targetVersion })}</small>
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
                <ExternalLink aria-hidden="true" size={14} />
                {t("settings.update.release")}
              </button>
            </span>
          )}
          <small>
            {t("settings.update.source", {
              label: installationSourceLabel(state.installationSource, t),
            })}
          </small>
        </span>
        <div className="settings-update-actions">
          {manualDownloadLabel && !showMacManualUpdate && (
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
          {state.status === "downloading" && (
            <button
              className="settings-secondary-button"
              disabled={actionPending}
              onClick={() =>
                runSettingsUpdateAction(async () => {
                  onStateChange(await window.desktop.updater.cancelDownload())
                })
              }
              type="button"
            >
              {t("settings.update.cancelDownload")}
            </button>
          )}
          {state.status === "downloaded" && (
            <>
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
            </>
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
        </div>
      </div>
      {showMacManualUpdate && (
        <div className="desktop-mac-update-guide">
          <div className="settings-mac-update-header">
            <strong>{t("settings.update.mac.title")}</strong>
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
          </div>
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
