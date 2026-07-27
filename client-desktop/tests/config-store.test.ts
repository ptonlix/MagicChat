import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ConfigStore } from "@main/config-store"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe("桌面配置迁移", () => {
  it("为旧配置补充 schema 与隐私默认值且幂等", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    await writeFile(path.join(directory, "desktop-config.json"), JSON.stringify({ servers: [] }))
    const store = new ConfigStore(directory)
    await store.load()
    expect(store.getSettings()).toMatchObject({
      autoLaunch: false,
      closeBehavior: "background",
      messageSoundEnabled: true,
      notificationPrivacy: "metadata",
    })
    await store.load()
    const persisted = JSON.parse(
      await readFile(path.join(directory, "desktop-config.json"), "utf8"),
    ) as { schemaVersion: number }
    expect(persisted.schemaVersion).toBe(1)
  })

  it("持久化新消息提示音设置", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    const store = new ConfigStore(directory)
    await store.load()

    await store.setSettings({ messageSoundEnabled: false })

    const reloaded = new ConfigStore(directory)
    await reloaded.load()
    expect(reloaded.getSettings().messageSoundEnabled).toBe(false)
  })

  it("迁移时将类型错误的设置字段恢复为默认值", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    await writeFile(
      path.join(directory, "desktop-config.json"),
      JSON.stringify({
        schemaVersion: 1,
        servers: [],
        settings: {
          autoLaunch: "true",
          closeBehavior: "hide",
          messageSoundEnabled: "false",
          notificationPrivacy: 1,
          selectedServerId: 123,
        },
      }),
    )

    const store = new ConfigStore(directory)
    await store.load()

    expect(store.getSettings()).toEqual({
      autoLaunch: false,
      closeBehavior: "background",
      messageSoundEnabled: true,
      notificationPrivacy: "metadata",
    })
  })

  it("设置持久化失败时保留原有内存状态", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    const filePath = path.join(directory, "desktop-config.json")
    const store = new ConfigStore(directory)
    await store.load()
    await rm(filePath)
    await mkdir(filePath)

    await expect(store.setSettings({ messageSoundEnabled: false })).rejects.toThrow()

    expect(store.getSettings().messageSoundEnabled).toBe(true)
  })

  it("拒绝覆盖来自更高版本的配置", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    const filePath = path.join(directory, "desktop-config.json")
    const raw = JSON.stringify({ schemaVersion: 99, settings: {}, servers: [] })
    await writeFile(filePath, raw)
    await expect(new ConfigStore(directory).load()).rejects.toThrow("更高版本")
    expect(await readFile(filePath, "utf8")).toBe(raw)
  })
})
