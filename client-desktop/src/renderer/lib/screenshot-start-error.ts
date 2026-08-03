import { toast } from "sonner"
import type { ScreenshotErrorCode } from "@shared/screenshot-contract"

export const SCREEN_PERMISSION_TOAST_ID = "screenshot-screen-permission-required"

export function dismissScreenshotPermissionToast() {
  toast.dismiss(SCREEN_PERMISSION_TOAST_ID)
}

export function showScreenshotStartError(code: ScreenshotErrorCode) {
  const message = screenshotErrorMessage(code)
  if (code !== "permission_denied") {
    dismissScreenshotPermissionToast()
    toast.error(message)
    return
  }

  toast.error(message, {
    action: {
      label: "前往设置",
      onClick: (event) => {
        event.preventDefault()
        void window.desktop.permissions.openSettings("screen").then(
          (opened) => {
            if (!opened) toast.error("当前系统不支持直接打开屏幕录制设置")
          },
          () => toast.error("无法打开系统设置，请手动允许屏幕录制权限"),
        )
      },
    },
    closeButton: true,
    duration: Infinity,
    id: SCREEN_PERMISSION_TOAST_ID,
  })
}

function screenshotErrorMessage(code: ScreenshotErrorCode): string {
  if (code === "permission_denied")
    return "截图需要屏幕录制权限，请前往“系统设置 > 隐私与安全性 > 屏幕录制”允许 MagicChat"
  if (code === "capture_timeout") return "屏幕截图响应超时，请重试"
  if (code === "unsupported_multi_display") return "当前桌面环境暂不支持多显示器截图"
  if (code === "capture_unavailable") return "当前没有可用的屏幕截图来源"
  return "无法完成屏幕截图"
}
