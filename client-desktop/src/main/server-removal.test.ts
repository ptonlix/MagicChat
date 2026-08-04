// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import type { ServerProfile } from "@shared/bridge"
import { removeServerResources, type ServerRemovalDependencies } from "./server-removal"

const profile: ServerProfile = {
  createdAt: "2026-07-30T00:00:00Z",
  displayName: "工作区",
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
}

describe("Server 移除生命周期", () => {
  it("缓存清理调度失败也必须清理 Session、凭据和 Profile", async () => {
    const calls: string[] = []
    const deps: ServerRemovalDependencies = {
      asr: { closeServer: vi.fn(() => calls.push("asr")) },
      documentCollaboration: {
        closeServer: vi.fn(() => calls.push("document-collaboration")),
      },
      credentials: {
        removeServer: vi.fn(async () => {
          calls.push("credentials")
        }),
      },
      files: {
        cleanupServer: vi.fn(async () => {
          calls.push("files")
        }),
      },
      http: {
        cancelServer: vi.fn(() => {
          calls.push("http")
        }),
      },
      messageCache: {
        clearServerBestEffort: vi.fn(() => {
          calls.push("cache")
          throw new Error("cache unavailable")
        }),
      },
      realtime: {
        closeServer: vi.fn(() => {
          calls.push("realtime")
        }),
      },
      sessions: {
        remove: vi.fn(async () => {
          calls.push("sessions")
        }),
      },
      store: {
        removeServer: vi.fn(async () => {
          calls.push("profile")
        }),
      },
      uploads: {
        cleanupServer: vi.fn(() => {
          calls.push("uploads")
        }),
      },
    }

    await expect(removeServerResources(deps, profile.id, profile)).resolves.toBeUndefined()

    expect(deps.sessions.remove).toHaveBeenCalledWith(profile)
    expect(deps.credentials.removeServer).toHaveBeenCalledWith(profile.id)
    expect(deps.store.removeServer).toHaveBeenCalledWith(profile.id)
    expect(calls.indexOf("http")).toBeLessThan(calls.indexOf("sessions"))
    expect(calls.indexOf("asr")).toBeLessThan(calls.indexOf("sessions"))
    expect(calls.at(-1)).toBe("profile")
  })
})
