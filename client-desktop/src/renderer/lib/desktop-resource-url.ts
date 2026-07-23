import type { ServerProfile } from "@desktop/shared/bridge"

export function resolveDesktopResourceUrl(profile: ServerProfile, value: string): string {
  try {
    const resolved = new URL(value, `${profile.normalizedUrl}/`)
    if (["blob:", "data:"].includes(resolved.protocol)) return resolved.toString()
    const server = new URL(profile.normalizedUrl)
    if (resolved.origin === server.origin) {
      if (isBundledDesktopResource(resolved.pathname)) {
        return `${resolved.pathname}${resolved.search}`
      }
      return resolved.pathname.startsWith("/api/client/")
        ? `magicchat-media://asset/${encodeURIComponent(profile.id)}${resolved.pathname}${resolved.search}`
        : ""
    }
    return resolved.protocol === "https:" ? resolved.toString() : ""
  } catch {
    return ""
  }
}

function isBundledDesktopResource(pathname: string): boolean {
  return (
    /^\/assets\/avatars\/builtin\/(?:0[1-9]|[1-5][0-9]|6[0-4])\.webp$/.test(
      pathname
    ) || pathname === "/assets/apps/assistant.webp"
  )
}
