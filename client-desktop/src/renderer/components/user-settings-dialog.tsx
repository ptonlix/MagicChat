import { useState } from "react"
import { useLocale } from "@/components/locale-provider"
import { Loader2Icon, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "@/lib/browser-notifications"
import { playMessageNotificationSound } from "@/lib/message-notification-sound"

type UserSettingsDialogProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function UserSettingsDialog({ onOpenChange, open }: UserSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <UserSettingsDialogContent />}
    </Dialog>
  )
}

function UserSettingsDialogContent() {
  const { t } = useLocale()
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(() => getBrowserNotificationPermission())
  const [notificationRequesting, setNotificationRequesting] = useState(false)

  async function handleNotificationPermissionRequest() {
    if (notificationRequesting || notificationPermission !== "default") return

    playMessageNotificationSound()
    setNotificationRequesting(true)
    try {
      setNotificationPermission(await requestBrowserNotificationPermission())
    } finally {
      setNotificationRequesting(false)
    }
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="flex w-[calc(100vw-2rem)] max-w-md flex-col gap-5 rounded-md border bg-background p-5 text-foreground shadow-lg ring-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <DialogTitle className="text-base font-medium">{t("userSettings.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("userSettings.desc")}</DialogDescription>
        </div>
        <DialogClose asChild>
          <Button aria-label={t("userSettings.close")} size="icon-sm" type="button" variant="ghost">
            <X className="size-4" />
          </Button>
        </DialogClose>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t("userSettings.desktopNotifications")}</div>
          <div className="text-xs text-muted-foreground">
            {getNotificationPermissionText(notificationPermission, t)}
          </div>
        </div>
        {notificationPermission === "default" && (
          <Button
            className="shrink-0"
            disabled={notificationRequesting}
            onClick={() => void handleNotificationPermissionRequest()}
            size="sm"
            type="button"
          >
            {notificationRequesting && <Loader2Icon aria-hidden="true" className="animate-spin" />}
            {t("userSettings.enable")}
          </Button>
        )}
      </div>

      <div className="flex justify-end">
        <DialogClose asChild>
          <Button type="button">{t("userSettings.closeBtn")}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  )
}

function getNotificationPermissionText(
  permission: BrowserNotificationPermission,
  t: ReturnType<typeof useLocale>["t"],
) {
  switch (permission) {
    case "granted":
      return t("userSettings.status.enabled")
    case "denied":
      return t("userSettings.status.blocked")
    case "unsupported":
      return t("userSettings.status.unsupported")
    default:
      return t("userSettings.status.off")
  }
}
