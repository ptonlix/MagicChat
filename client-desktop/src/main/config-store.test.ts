// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ConfigStore } from "./config-store"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("桌面配置存储", () => {
  it("为旧配置补充默认截图快捷键", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    await writeFile(
      path.join(directory, "desktop-config.json"),
      JSON.stringify({
        schemaVersion: 1,
        servers: [],
        settings: {
          autoLaunch: false,
          closeBehavior: "background",
          messageSoundEnabled: true,
          notificationPrivacy: "metadata",
        },
      }),
    )

    const store = new ConfigStore(directory)
    await store.load()

    expect(store.getSettings().screenshotShortcut).toBe("CommandOrControl+Shift+A")
    expect(store.getSettings().searchShortcut).toBe("CommandOrControl+Shift+F")
    expect(store.getSettings().sendMessageShortcut).toBe("CommandOrControl+Enter")
  })

  it("持久化修改和禁用的截图快捷键", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    const store = new ConfigStore(directory)
    await store.load()

    await store.setSettings({ screenshotShortcut: "Control+Alt+S" })
    const reopened = new ConfigStore(directory)
    await reopened.load()
    expect(reopened.getSettings().screenshotShortcut).toBe("Control+Alt+S")

    await reopened.setSettings({ screenshotShortcut: null })
    const persisted = JSON.parse(
      await readFile(path.join(directory, "desktop-config.json"), "utf8"),
    ) as { settings: { screenshotShortcut?: unknown } }
    expect(persisted.settings.screenshotShortcut).toBeNull()
  })

  it("持久化修改和禁用的搜索与发送消息快捷键", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    const store = new ConfigStore(directory)
    await store.load()

    await store.setSettings({ searchShortcut: "Control+Alt+F" })
    await store.setSettings({ sendMessageShortcut: null })

    const reopened = new ConfigStore(directory)
    await reopened.load()
    expect(reopened.getSettings().searchShortcut).toBe("Control+Alt+F")
    expect(reopened.getSettings().sendMessageShortcut).toBeNull()
  })

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
