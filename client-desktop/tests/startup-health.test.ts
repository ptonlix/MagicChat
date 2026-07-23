import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { StartupHealth } from "../src/main/startup-health"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("启动健康标记", () => {
  it("识别未完成启动并在 Renderer 就绪后写入健康状态", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-health-"))
    directories.push(directory)
    const first = new StartupHealth(directory, "1.0.0")
    expect(await first.begin()).toEqual({ previousStartupIncomplete: false })

    const second = new StartupHealth(directory, "1.0.1")
    expect(await second.begin()).toEqual({ previousStartupIncomplete: true })
    await second.markHealthy()
    const state = JSON.parse(await readFile(path.join(directory, "startup-health.json"), "utf8"))
    expect(state).toMatchObject({ schemaVersion: 1, status: "healthy", version: "1.0.1" })
  })
})
