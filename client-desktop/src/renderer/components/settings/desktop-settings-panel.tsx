import { useCallback, useEffect, useRef, useState } from "react"
import { Download, ExternalLink, RefreshCw, Sparkles, Trash2 } from "lucide-react"

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
  DesktopSettings,
  DesktopSettingsPatch,
  ServerProfile,
  UpdaterState,
} from "@shared/bridge"
import type { MessageCacheStats } from "@shared/message-cache-contract"
import { DESKTOP_SETTINGS_CHANGED_EVENT } from "@/hooks/use-desktop-settings"
import { SettingsCenter, type SettingsSectionId } from "./settings-center"
import { ShortcutRecorder } from "./shortcut-recorder"
import {
  DEFAULT_SCREENSHOT_SHORTCUT,
  DEFAULT_SEARCH_SHORTCUT,
  DEFAULT_SEND_MESSAGE_SHORTCUT,
} from "@shared/shortcut-contract"

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
        setSettingsLoadError("设置读取失败，请重试")
      }
    } finally {
      if (generation === loadGenerationRef.current) setSettingsLoading(false)
    }
  }, [target])

  useEffect(() => {
    void loadSettings()
    return () => {
      loadGenerationRef.current += 1
    }
  }, [loadSettings])

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
      window.dispatchEvent(new Event(DESKTOP_SETTINGS_CHANGED_EVENT))
    } catch {
      setSettingsError("设置保存失败，请重试")
    }
  }

  async function renameServer() {
    setBusy(true)
    setRenameError("")
    try {
      await window.desktop.servers.rename(profile.id, name)
      window.location.reload()
    } catch {
      setRenameError("工作空间名称保存失败，请重试")
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
    <SettingsCenter
      activeSection={activeSection}
      platform={platform}
      profile={profile}
      onOpenChange={onOpenChange}
      onSectionChange={setActiveSection}
    >
      {settingsLoading && !settings ? (
        <div className="settings-center-loading">
          <Sparkles aria-hidden="true" size={18} />
          <span>正在准备设置</span>
        </div>
      ) : !settings ? (
        <div className="settings-center-load-error" role="alert">
          <strong>{settingsLoadError || "设置读取失败"}</strong>
          <button onClick={() => void loadSettings()} type="button">
            重试
          </button>
        </div>
      ) : (
        <div className="settings-center-page">
          {settingsError && <p role="alert">{settingsError}</p>}

          {activeSection === "general" && (
            <section aria-labelledby="settings-general-title" className="settings-group">
              <h3 id="settings-general-title">通用设置</h3>
              <label className="settings-row">
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
              <label className="settings-row">
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
            </section>
          )}

          {activeSection === "notifications" && (
            <section aria-labelledby="settings-notifications-title" className="settings-group">
              <h3 id="settings-notifications-title">新消息通知</h3>
              <label className="settings-row">
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
              <label className="settings-row">
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
          )}

          {activeSection === "appearance" && (
            <section aria-labelledby="settings-appearance-title" className="settings-group">
              <h3 id="settings-appearance-title">应用配色</h3>
              <div aria-label="应用配色" className="settings-theme-options" role="radiogroup">
                {(
                  [
                    ["system", "跟随系统"],
                    ["light", "浅色"],
                    ["dark", "深色"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    aria-checked={theme === value}
                    className="settings-theme-option"
                    key={value}
                    onClick={() => setTheme(value)}
                    role="radio"
                    type="button"
                  >
                    <span aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {activeSection === "storage" && (
            <section aria-labelledby="settings-storage-title" className="settings-group">
              <h3 id="settings-storage-title">本地消息缓存</h3>
              <div className="settings-row">
                <span>
                  <strong>{formatCacheSize(cacheStats?.payloadBytes ?? 0)}</strong>
                  <small>{cacheStatusText(cacheStats?.status)}</small>
                </span>
                <button
                  aria-label="清理本地消息缓存"
                  className="settings-secondary-button"
                  disabled={cacheClearing}
                  onClick={() => void clearMessageCache()}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  清理缓存
                </button>
              </div>
            </section>
          )}

          {activeSection === "shortcuts" && (
            <section aria-labelledby="settings-shortcuts-title" className="settings-group">
              <h3 id="settings-shortcuts-title">键盘快捷键</h3>
              <div className="settings-row">
                <span>
                  <strong>全局搜索</strong>
                  <small>在任意应用中按下即可唤起全局搜索</small>
                </span>
                <ShortcutRecorder
                  defaultAccelerator={DEFAULT_SEARCH_SHORTCUT}
                  kind="search"
                  label="全局搜索快捷键"
                  platform={platform ?? "unknown"}
                />
              </div>
              <div className="settings-row">
                <span>
                  <strong>发送消息</strong>
                  <small>在聊天输入框中按下即可发送消息</small>
                </span>
                <ShortcutRecorder
                  defaultAccelerator={DEFAULT_SEND_MESSAGE_SHORTCUT}
                  kind="sendMessage"
                  label="发送消息快捷键"
                  platform={platform ?? "unknown"}
                />
              </div>
              <div className="settings-row">
                <span>
                  <strong>截图</strong>
                  <small>在其他应用中也可以启动即应截图</small>
                </span>
                <ShortcutRecorder
                  defaultAccelerator={DEFAULT_SCREENSHOT_SHORTCUT}
                  kind="screenshot"
                  label="截图快捷键"
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
              <h3 id="settings-workspace-title">工作空间</h3>
              <label className="settings-row settings-row-stack">
                <span>
                  <strong>显示名称</strong>
                  <small>仅影响此设备上的展示</small>
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
                    保存
                  </button>
                </div>
                {renameError && <small className="settings-field-error">{renameError}</small>}
              </label>
              <div className="settings-row settings-server-row">
                <span>
                  <strong>服务器地址</strong>
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
                  移除服务器
                </button>
              </div>
              {removeError && <p role="alert">{removeError}</p>}
            </section>
          )}

          {activeSection === "about" && (
            <section aria-labelledby="settings-about-title" className="settings-group">
              <h3 id="settings-about-title">关于即应</h3>
              <div className="settings-about-brand">
                <img alt="即应" src="/logo.png" />
                <div>
                  <strong>即应</strong>
                  <span>
                    {appInfo
                      ? `${appInfo.version} · ${appInfo.platform} ${appInfo.arch}`
                      : "正在读取版本信息"}
                  </span>
                  {appInfo && (
                    <small>
                      {releaseChannelLabel(appInfo.channel)} · 构建 {appInfo.build}
                    </small>
                  )}
                </div>
              </div>
              <button
                className="settings-secondary-button settings-diagnostics-button"
                onClick={() => void window.desktop.diagnostics.export()}
                type="button"
              >
                导出脱敏诊断
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

function cacheStatusText(status: MessageCacheStats["status"] | undefined): string {
  if (status === "available") return "缓存可用，不包含附件文件"
  if (status === "rebuilding") return "正在重建缓存，在线聊天不受影响"
  if (status === "degraded") return "缓存暂不可用，已切换为内存模式"
  return "正在读取缓存状态"
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
  const [updateActionError, setUpdateActionError] = useState("")
  const { actionPending, runUpdateAction } = useDesktopUpdateAction(setUpdateActionError)
  const showMacManualUpdate =
    state.installationSource === "mac_app" &&
    Boolean(state.targetVersion) &&
    (state.status === "available" || state.status === "error")
  const manualDownloadLabel = showMacManualUpdate
    ? "下载 macOS 安装包"
    : state.installMode === "manual" && (state.status === "available" || state.status === "manual")
      ? (state.manualAction?.label ?? "下载安装包")
      : undefined

  function runSettingsUpdateAction(action: () => Promise<void>) {
    setUpdateActionError("")
    void runUpdateAction(action)
  }

  return (
    <section aria-labelledby="settings-updates-title" className="settings-group">
      <h3 id="settings-updates-title">软件更新</h3>
      <div className="settings-row settings-update-status">
        <span>
          <strong>当前版本 {state.currentVersion || "正在读取"}</strong>
          <small>{updateStatusText(state)}</small>
          {state.targetVersion && <small>目标版本：{state.targetVersion}</small>}
          <small>安装来源：{installationSourceLabel(state.installationSource)}</small>
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
            aria-label="检查更新"
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
            title="检查更新"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            检查更新
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
          查看发布内容
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
            ? "下载并自动更新"
            : `下载 ${state.targetVersion}`}
        </button>
      )}
      {state.status === "downloaded" && (
        <div className="grid grid-cols-2 gap-2">
          <button className="settings-secondary-button" onClick={onClose} type="button">
            稍后
          </button>
          <button
            className="settings-primary-button"
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
            <Sparkles aria-hidden="true" size={16} />
            安装并重启
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
        </div>
      )}
      {updateActionError && <p role="alert">{updateActionError}</p>}
    </section>
  )
}
