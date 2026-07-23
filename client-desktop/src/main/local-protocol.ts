import { readFile } from "node:fs/promises"
import path from "node:path"
import { net, protocol } from "electron"
import type { ServerProfiles } from "./server-profiles"
import type { SessionController } from "./session-controller"

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "magicchat-app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true },
    },
    {
      scheme: "magicchat-media",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ])
}

export function installLocalProtocol(
  rendererDirectory: string,
  profiles: ServerProfiles,
  sessions: SessionController
): void {
  const root = path.resolve(rendererDirectory)
  protocol.handle("magicchat-app", async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== "app" || request.method !== "GET") return new Response("Not found", { status: 404 })
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^\/+/, "")
    const candidate = path.resolve(root, relative)
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return new Response("Forbidden", { status: 403 })
    try {
      const body = await readFile(candidate)
      return new Response(body, { headers: { "Content-Type": mimeTypes[path.extname(candidate)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" } })
    } catch {
      if (!path.extname(relative)) return net.fetch("magicchat-app://app/index.html")
      return new Response("Not found", { status: 404 })
    }
  })
  protocol.handle("magicchat-media", async (request) => {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 })
    try {
      const url = new URL(request.url)
      if (url.hostname !== "asset") return new Response("Not found", { status: 404 })
      const segments = url.pathname.split("/").filter(Boolean)
      const serverId = decodeURIComponent(segments.shift() ?? "")
      const apiPath = `/${segments.join("/")}`
      if (!/^[a-zA-Z0-9_-]+$/.test(serverId) || !apiPath.startsWith("/api/client/")) {
        return new Response("Forbidden", { status: 403 })
      }
      const profile = profiles.require(serverId)
      const headers = new Headers()
      for (const name of ["accept", "range"]) {
        const value = request.headers.get(name)
        if (value) headers.set(name, value)
      }
      const upstream = await sessions.for(profile).fetch(
        `${profile.normalizedUrl}${apiPath}${url.search}`,
        { credentials: "include", headers }
      )
      const responseHeaders = new Headers()
      for (const name of ["accept-ranges", "cache-control", "content-length", "content-range", "content-type", "etag", "last-modified"]) {
        const value = upstream.headers.get(name)
        if (value) responseHeaders.set(name, value)
      }
      responseHeaders.set("X-Content-Type-Options", "nosniff")
      return new Response(upstream.body, {
        headers: responseHeaders,
        status: upstream.status,
        statusText: upstream.statusText,
      })
    } catch {
      return new Response("Not found", { status: 404 })
    }
  })
}
