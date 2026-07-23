import type { DesktopAppInfo } from "@shared/bridge"

const releaseChannelLabels = {
  preview: "预览版",
  stable: "正式版",
  test: "开发版",
} satisfies Record<DesktopAppInfo["channel"], string>

export function releaseChannelLabel(channel: DesktopAppInfo["channel"]): string {
  return releaseChannelLabels[channel]
}
