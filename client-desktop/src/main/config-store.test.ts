// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ConfigStore } from "./config-store"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("桌面配置存储", () => {
  it("持久撤销已注销用户", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    const store = new ConfigStore(directory)
    await store.load()
    const profile = await store.addServer({
      displayName: "工作区",
      lastUserId: "user-1",
      normalizedUrl: "https://chat.example.com",
    })

    await store.revokeUser(profile.id, "user-1")

    expect(store.server(profile.id)).toEqual({
      createdAt: profile.createdAt,
      displayName: profile.displayName,
      id: profile.id,
      normalizedUrl: profile.normalizedUrl,
    })
    const reopened = new ConfigStore(directory)
    await reopened.load()
    expect(reopened.server(profile.id)?.lastUserId).toBeUndefined()
  })
})
