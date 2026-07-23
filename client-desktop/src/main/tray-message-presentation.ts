import {
  cleanNotificationPreview,
  cleanNotificationText,
  type NotificationPrivacy,
} from "@main/notification-privacy"
import { formatUnreadBadge } from "@main/unread-badge"
import type { TrayMessage } from "@shared/bridge"

export type TrayMessagePresentation = {
  label: string
  sublabel: string
}

export function presentTrayMessage(
  message: TrayMessage,
  privacy: NotificationPrivacy,
): TrayMessagePresentation {
  const name = privacy === "hidden"
    ? "新消息"
    : cleanNotificationText(message.name, 16) || "未命名会话"
  const badge = formatUnreadBadge(message.unreadCount)
  const sublabel = privacy === "hidden"
    ? "你收到了一条新消息"
    : privacy === "metadata"
      ? "有新消息"
      : cleanNotificationPreview(message.summary, 24)

  return {
    label: badge ? `${name}  [${badge}]` : name,
    sublabel,
  }
}
