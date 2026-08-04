import { useCallback, useRef, useState } from "react"

import type { UpdaterInstallResult, UpdaterState } from "@shared/bridge"

export function useDesktopUpdateAction(onError: (message: string) => void) {
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

export function updateStatusText(state: UpdaterState): string {
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

export function getUpdateInstallErrorMessage(reason: UpdaterInstallResult["reason"]): string {
  if (reason === "install_failed") return "自动安装未能启动，请重试检查或使用手动更新"
  if (reason === "active_transfers") return "仍有文件正在传输，请完成或取消传输后重试"
  if (reason === "install_in_progress") return "更新安装已在进行中"
  if (reason === "not_downloaded") return "更新尚未下载完成，请稍后重试"
  return "更新准备未完成，请稍后重试"
}

export function installationSourceLabel(source: UpdaterState["installationSource"]): string {
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
