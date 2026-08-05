import type { Translator, TranslationKey } from "@/lib/i18n"
import type { DesktopAppInfo } from "@shared/bridge"

const releaseChannelKeys: Record<DesktopAppInfo["channel"], TranslationKey> = {
  preview: "settings.release.preview",
  stable: "settings.release.stable",
  test: "settings.release.test",
}

export function releaseChannelLabel(channel: DesktopAppInfo["channel"], t: Translator): string {
  return t(releaseChannelKeys[channel])
}
