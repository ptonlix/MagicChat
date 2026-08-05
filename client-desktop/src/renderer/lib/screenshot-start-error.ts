import { toast } from "sonner"
import type { ScreenshotErrorCode } from "@shared/screenshot-contract"
import type { Translator } from "@/lib/i18n"

export const SCREEN_PERMISSION_TOAST_ID = "screenshot-screen-permission-required"

export function dismissScreenshotPermissionToast() {
  toast.dismiss(SCREEN_PERMISSION_TOAST_ID)
}

export function showScreenshotStartError(code: ScreenshotErrorCode, t: Translator) {
  const message = screenshotErrorMessage(code, t)
  if (code !== "permission_denied") {
    dismissScreenshotPermissionToast()
    toast.error(message)
    return
  }

  toast.warning(message, {
    action: {
      label: t("screenshot.openSettings"),
      onClick: (event) => {
        event.preventDefault()
        void window.desktop.permissions.openSettings("screen").then(
          (opened) => {
            if (!opened) toast.error(t("screenshot.openSettingsUnsupported"))
          },
          () => toast.error(t("screenshot.openSettingsFailed")),
        )
      },
    },
    closeButton: true,
    duration: Infinity,
    id: SCREEN_PERMISSION_TOAST_ID,
  })
}

function screenshotErrorMessage(code: ScreenshotErrorCode, t: Translator): string {
  if (code === "permission_denied") return t("screenshot.error.permissionDenied")
  if (code === "capture_timeout") return t("screenshot.error.captureTimeout")
  if (code === "unsupported_multi_display") return t("screenshot.error.unsupportedMultiDisplay")
  if (code === "capture_unavailable") return t("screenshot.error.captureUnavailable")
  return t("screenshot.error.unknown")
}
