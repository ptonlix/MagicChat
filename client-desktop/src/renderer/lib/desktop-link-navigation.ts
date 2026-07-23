export type DesktopLinkAction = "blocked" | "external" | "internal" | "unhandled"

export function classifyDesktopLink(
  anchor: HTMLAnchorElement,
  currentLocation = window.location.href
): { action: DesktopLinkAction; url?: string } {
  const href = anchor.getAttribute("href")
  if (!href) return { action: "unhandled" }

  let targetUrl: URL
  let currentUrl: URL
  try {
    targetUrl = new URL(href, currentLocation)
    currentUrl = new URL(currentLocation)
  } catch {
    return { action: "blocked" }
  }

  if (targetUrl.origin === currentUrl.origin) {
    return { action: "internal" }
  }
  if (targetUrl.protocol === "https:") {
    return { action: "external", url: targetUrl.toString() }
  }
  if (targetUrl.protocol === "http:") {
    return { action: "blocked" }
  }

  return { action: "unhandled" }
}

export function installDesktopLinkNavigation(
  openExternal: (url: string) => void
) {
  const handleClick = (event: MouseEvent) => {
    const anchor =
      event.target instanceof Element ? event.target.closest("a[href]") : null
    if (!(anchor instanceof HTMLAnchorElement)) return

    const result = classifyDesktopLink(anchor)
    if (result.action === "internal" || result.action === "unhandled") return

    event.preventDefault()
    if (result.action === "external" && result.url) {
      openExternal(result.url)
    }
  }

  document.addEventListener("click", handleClick, true)
  return () => document.removeEventListener("click", handleClick, true)
}
