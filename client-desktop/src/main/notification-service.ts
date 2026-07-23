import { Notification } from "electron"
import { targetKey } from "@shared/client-contract"
import type { DesktopSettings, NotificationInput } from "@shared/bridge"

const rank = { hidden: 0, metadata: 1, preview: 2 } as const

export class NotificationService {
  private readonly shown = new Map<string, number>()

  constructor(private readonly settings: () => DesktopSettings, private readonly onClick: (input: NotificationInput) => Promise<void>, private readonly enterpriseMaximum: DesktopSettings["notificationPrivacy"] = "preview") {}

  async show(input: NotificationInput): Promise<void> {
    if (input.muted || !Notification.isSupported()) return
    this.cleanup()
    const key = `${targetKey(input.target)}:${input.messageId}`
    if (this.shown.has(key)) return
    this.shown.set(key, Date.now())
    const privacy = stricter(this.settings().notificationPrivacy, this.enterpriseMaximum)
    const title = privacy === "hidden" ? "MagicChat 新消息" : cleanText(input.workspace || input.sender || "MagicChat", 80)
    const body = privacy === "hidden"
      ? "你收到了一条新消息"
      : privacy === "metadata"
        ? cleanText(input.sender ? `${input.sender} 发来新消息` : "会话中有新消息", 120)
        : cleanPreview(input.preview)
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

function stricter(user: DesktopSettings["notificationPrivacy"], policy: DesktopSettings["notificationPrivacy"]): DesktopSettings["notificationPrivacy"] {
  return rank[user] <= rank[policy] ? user : policy
}

function cleanPreview(value?: string): string {
  const cleaned = cleanText((value ?? "").replace(/```[\s\S]*?```/g, "").replace(/<[^>]+>/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_~#>`]/g, ""), 160)
  return cleaned || "你收到了一条新消息"
}

function cleanText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
}
