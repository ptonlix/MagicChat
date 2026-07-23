import { Notification } from "electron"
import {
  cleanNotificationPreview,
  cleanNotificationText,
  resolveNotificationPrivacy,
} from "@main/notification-privacy"
import { targetKey } from "@shared/client-contract"
import type { DesktopSettings, NotificationInput } from "@shared/bridge"

export class NotificationService {
  private readonly shown = new Map<string, number>()

  constructor(private readonly settings: () => DesktopSettings, private readonly onClick: (input: NotificationInput) => Promise<void>, private readonly enterpriseMaximum: DesktopSettings["notificationPrivacy"] = "preview") {}

  async show(input: NotificationInput): Promise<void> {
    if (input.muted || !Notification.isSupported()) return
    this.cleanup()
    const key = `${targetKey(input.target)}:${input.messageId}`
    if (this.shown.has(key)) return
    this.shown.set(key, Date.now())
    const privacy = resolveNotificationPrivacy(this.settings().notificationPrivacy, this.enterpriseMaximum)
    const title = privacy === "hidden" ? "MagicChat 新消息" : cleanNotificationText(input.workspace || input.sender || "MagicChat", 80)
    const body = privacy === "hidden"
      ? "你收到了一条新消息"
      : privacy === "metadata"
        ? cleanNotificationText(input.sender ? `${input.sender} 发来新消息` : "会话中有新消息", 120)
        : cleanNotificationPreview(input.preview)
    const notification = new Notification({ title, body, silent: false })
    notification.on("click", () => void this.onClick(input))
    notification.show()
  }

  clearTarget(target: NotificationInput["target"]): void {
    const prefix = `${targetKey(target)}:`
    for (const key of this.shown.keys()) if (key.startsWith(prefix)) this.shown.delete(key)
  }

  private cleanup(): void {
    const cutoff = Date.now() - 24 * 60 * 60_000
    for (const [key, time] of this.shown) if (time < cutoff) this.shown.delete(key)
  }
}
