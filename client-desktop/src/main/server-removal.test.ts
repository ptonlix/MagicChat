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
      documentWindows: {
        deleteServerState: vi.fn(async () => {
          calls.push("document-window-state")
        }),
        requestCloseServer: vi.fn(async () => {
          calls.push("document-windows")
          return true
        }),
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

    await expect(removeServerResources(deps, profile.id, profile)).resolves.toBe(true)

    expect(deps.sessions.remove).toHaveBeenCalledWith(profile)
    expect(deps.documentWindows?.requestCloseServer).toHaveBeenCalledWith(profile.id)
    expect(deps.documentWindows?.deleteServerState).toHaveBeenCalledWith(profile.id)
    expect(deps.credentials.removeServer).toHaveBeenCalledWith(profile.id)
    expect(deps.store.removeServer).toHaveBeenCalledWith(profile.id)
    expect(calls.at(0)).toBe("document-windows")
    expect(calls.indexOf("http")).toBeLessThan(calls.indexOf("sessions"))
    expect(calls.indexOf("asr")).toBeLessThan(calls.indexOf("sessions"))
    expect(calls.at(-1)).toBe("profile")
  })

  it("未同步文档取消关闭时终止移除且不清理任何服务器资源", async () => {
    const requestCloseServer = vi.fn(async () => false)
    const deps = {
      asr: { closeServer: vi.fn() },
      documentCollaboration: { closeServer: vi.fn() },
      documentWindows: { deleteServerState: vi.fn(), requestCloseServer },
      credentials: { removeServer: vi.fn() },
      files: { cleanupServer: vi.fn() },
      http: { cancelServer: vi.fn() },
      messageCache: { clearServerBestEffort: vi.fn() },
      realtime: { closeServer: vi.fn() },
      sessions: { remove: vi.fn() },
      store: { removeServer: vi.fn() },
      uploads: { cleanupServer: vi.fn() },
    } as unknown as ServerRemovalDependencies

    await expect(removeServerResources(deps, profile.id, profile)).resolves.toBe(false)

    expect(requestCloseServer).toHaveBeenCalledWith(profile.id)
    expect(deps.http.cancelServer).not.toHaveBeenCalled()
    expect(deps.documentCollaboration.closeServer).not.toHaveBeenCalled()
    expect(deps.documentWindows?.deleteServerState).not.toHaveBeenCalled()
    expect(deps.credentials.removeServer).not.toHaveBeenCalled()
    expect(deps.store.removeServer).not.toHaveBeenCalled()
  })
})
