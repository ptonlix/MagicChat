import type { DesktopSettingsPatch } from "@shared/bridge"

const allowedDesktopSettings = new Set([
  "autoLaunch",
  "closeBehavior",
  "fontScale",
  "language",
  "messageSoundEnabled",
  "notificationPrivacy",
])

export function parseDesktopSettingsPatch(value: unknown): DesktopSettingsPatch {
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
  if (input.language !== undefined && input.language !== "zh-CN" && input.language !== "en") {
    throw new Error("语言设置无效")
  }
  if (
    input.fontScale !== undefined &&
    input.fontScale !== "normal" &&
    input.fontScale !== "medium" &&
    input.fontScale !== "large"
  ) {
    throw new Error("字体大小设置无效")
  }
  if (
    input.closeBehavior !== undefined &&
    input.closeBehavior !== "background" &&
    input.closeBehavior !== "quit"
  ) {
    throw new Error("关闭行为设置无效")
  }
  if (
    input.notificationPrivacy !== undefined &&
    input.notificationPrivacy !== "hidden" &&
    input.notificationPrivacy !== "metadata" &&
    input.notificationPrivacy !== "preview"
  ) {
    throw new Error("通知隐私设置无效")
  }

  return {
    ...(input.autoLaunch === undefined ? {} : { autoLaunch: input.autoLaunch }),
    ...(input.closeBehavior === undefined ? {} : { closeBehavior: input.closeBehavior }),
    ...(input.fontScale === undefined ? {} : { fontScale: input.fontScale }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(input.messageSoundEnabled === undefined
      ? {}
      : { messageSoundEnabled: input.messageSoundEnabled }),
    ...(input.notificationPrivacy === undefined
      ? {}
      : { notificationPrivacy: input.notificationPrivacy }),
  }
}
