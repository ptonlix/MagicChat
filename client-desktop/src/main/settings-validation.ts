import type { DesktopSettings } from "@shared/bridge"

const allowedDesktopSettings = new Set([
  "autoLaunch",
  "closeBehavior",
  "messageSoundEnabled",
  "notificationPrivacy",
  "selectedServerId",
])

export function parseDesktopSettingsPatch(value: unknown): Partial<DesktopSettings> {
  if (!value || typeof value !== "object") throw new Error("设置参数无效")
  const input = value as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!allowedDesktopSettings.has(key)) throw new Error("设置字段无效")
  }
  if (input.autoLaunch !== undefined && typeof input.autoLaunch !== "boolean") {
    throw new Error("开机自动启动设置无效")
  }
  if (input.messageSoundEnabled !== undefined && typeof input.messageSoundEnabled !== "boolean") {
    throw new Error("新消息提示音设置无效")
  }
  return { ...input } as Partial<DesktopSettings>
}
