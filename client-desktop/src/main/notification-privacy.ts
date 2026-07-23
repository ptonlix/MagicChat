import type { DesktopSettings } from "@shared/bridge"

export type NotificationPrivacy = DesktopSettings["notificationPrivacy"]

const privacyRank = { hidden: 0, metadata: 1, preview: 2 } as const

export function resolveNotificationPrivacy(
  userPrivacy: NotificationPrivacy,
  maximumPrivacy: NotificationPrivacy = "preview",
): NotificationPrivacy {
  return privacyRank[userPrivacy] <= privacyRank[maximumPrivacy]
    ? userPrivacy
    : maximumPrivacy
}

export function cleanNotificationPreview(value?: string, maximumLength = 160): string {
  const cleaned = cleanNotificationText(
    (value ?? "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~#>`]/g, ""),
    maximumLength,
  )
  return cleaned || "你收到了一条新消息"
}

export function cleanNotificationText(value: string, maximumLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength)
}
