import { useState } from "react"
import {
  Bell,
  BellRing,
  CheckCircle2,
  Loader2Icon,
  Palette,
  Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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

export function UserSettingsDialog({
  onOpenChange,
  open,
}: UserSettingsDialogProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && <UserSettingsDialogContent />}
    </Sheet>
  )
}

function UserSettingsDialogContent() {
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(() =>
      getBrowserNotificationPermission()
    )
  const [notificationRequesting, setNotificationRequesting] = useState(false)

  async function handleNotificationPermissionRequest() {
    if (notificationRequesting || notificationPermission !== "default") {
      return
    }

    playMessageNotificationSound()
    setNotificationRequesting(true)
    try {
      setNotificationPermission(await requestBrowserNotificationPermission())
    } finally {
      setNotificationRequesting(false)
    }
  }

  return (
    <SheetContent
      aria-label="设置"
      className="w-[min(460px,100vw)] gap-0 border-emerald-200/70 bg-white/95 p-0 shadow-2xl shadow-emerald-950/15 backdrop-blur-xl dark:border-emerald-900/60 dark:bg-slate-950/95 sm:max-w-none"
      side="right"
    >
      <SheetHeader className="border-b border-emerald-100 bg-gradient-to-br from-emerald-50 via-teal-50 to-white p-6 text-left dark:border-emerald-900/60 dark:from-emerald-950/70 dark:via-teal-950/50 dark:to-slate-950">
        <div className="flex items-center gap-3">
          <img alt="即应" className="size-11 rounded-xl shadow-lg shadow-emerald-700/20" src="/logo.png" />
          <div className="grid gap-1">
            <SheetTitle className="text-lg font-semibold tracking-tight">设置</SheetTitle>
            <SheetDescription>调整通知与界面显示方式</SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
        <section className="rounded-2xl border bg-card/85 p-4 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <BellRing className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">通知与提醒</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">及时获取新消息，同时保持专注</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/65 p-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                桌面通知
                {notificationPermission === "granted" && (
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {getNotificationPermissionText(notificationPermission)}
              </div>
            </div>
            {notificationPermission === "default" && (
              <Button
                className="shrink-0 bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-sm hover:from-emerald-600 hover:to-teal-600"
                disabled={notificationRequesting}
                onClick={() => void handleNotificationPermissionRequest()}
                type="button"
              >
                {notificationRequesting ? (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                ) : (
                  <Bell aria-hidden="true" />
                )}
                开启桌面通知
              </Button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card/85 p-4 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
              <Palette className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">品牌外观</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">即应绿色视觉已应用到整个桌面端</p>
            </div>
          </div>
          <div className="rounded-xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 text-xs leading-5 text-emerald-900 dark:border-emerald-900/70 dark:from-emerald-950/60 dark:to-teal-950/50 dark:text-emerald-100">
            浅色模式使用薄荷绿渐变与通透白色内容层，深色模式保留绿色高亮，减少长时间使用的视觉负担。
          </div>
        </section>

        <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 p-4 text-xs text-muted-foreground">
          <Sparkles className="size-4 shrink-0 text-emerald-600" />
          <span>设置会自动保存在当前设备，无需手动提交。</span>
        </div>
      </div>
    </SheetContent>
  )
}

function getNotificationPermissionText(
  permission: BrowserNotificationPermission
) {
  switch (permission) {
    case "granted":
      return "桌面通知已开启"
    case "denied":
      return "通知权限已被浏览器阻止"
    case "unsupported":
      return "当前浏览器不支持桌面通知"
    default:
      return "尚未开启"
  }
}
