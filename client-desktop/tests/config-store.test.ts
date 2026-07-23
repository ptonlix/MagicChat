import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ConfigStore } from "../src/main/config-store"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))) })

describe("桌面配置迁移", () => {
  it("为旧配置补充 schema 与隐私默认值且幂等", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-config-"))
    directories.push(directory)
    await writeFile(path.join(directory, "desktop-config.json"), JSON.stringify({ servers: [] }))
    const store = new ConfigStore(directory)
    await store.load()
    expect(store.getSettings()).toMatchObject({ autoLaunch: false, closeBehavior: "background", notificationPrivacy: "metadata" })
    await store.load()
    const persisted = JSON.parse(await readFile(path.join(directory, "desktop-config.json"), "utf8")) as { schemaVersion: number }
    expect(persisted.schemaVersion).toBe(1)
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
