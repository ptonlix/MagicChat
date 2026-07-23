import { appendFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Diagnostics } from "@main/diagnostics"
import type { RendererRuntimeSnapshot } from "@shared/bridge"

const electronMocks = vi.hoisted(() => ({ crashReporterStart: vi.fn(), showSaveDialog: vi.fn() }))

vi.mock("electron", () => ({
  app: {
    getAppMetrics: () => [{ cpu: { percentCPUUsage: 12 }, memory: { workingSetSize: 2048 }, type: "Renderer" }],
    getVersion: () => "0.0.1-test",
  },
  crashReporter: { start: electronMocks.crashReporterStart },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
}))

const temporaryDirectories: string[] = []

describe("Diagnostics", () => {
  beforeEach(() => {
    electronMocks.crashReporterStart.mockReset()
    electronMocks.showSaveDialog.mockReset()
    Object.defineProperty(process, "getSystemMemoryInfo", {
      configurable: true,
      value: () => ({ free: 1024, total: 4096 }),
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
  })

  it("串行写入并保持调用顺序", async () => {
    const { diagnostics, logPath } = await createDiagnostics()

    await Promise.all([
      diagnostics.record("main", "first"),
      diagnostics.record("main", "second"),
      diagnostics.record("main", "third"),
    ])

    expect((await records(logPath)).map((record) => record.code)).toEqual(["first", "second", "third"])
  })

  it("超过大小限制后只保留当前文件和一个轮转文件", async () => {
    const { diagnostics, logPath } = await createDiagnostics({ maxLogBytes: 500 })

    for (let index = 0; index < 12; index += 1) {
      await diagnostics.record("main", `record-${index}`)
    }

    const rotatedPath = `${logPath}.1`
    expect((await stat(logPath)).size).toBeLessThanOrEqual(500)
    expect((await stat(rotatedPath)).size).toBeLessThanOrEqual(500)
    expect((await records(logPath)).at(-1)?.code).toBe("record-11")
  })

  it("冷却周期内只补写最大的一次运行时卡顿", async () => {
    vi.useFakeTimers()
    const { diagnostics, logPath } = await createDiagnostics({ stallCooldownMs: 30_000 })

    diagnostics.updateRuntimeSnapshot(runtimeSnapshot(1_200))
    diagnostics.updateRuntimeSnapshot(runtimeSnapshot(1_500))
    diagnostics.updateRuntimeSnapshot(runtimeSnapshot(1_300))
    await diagnostics.record("main", "flush-first")
    await vi.advanceTimersByTimeAsync(30_000)
    await diagnostics.record("main", "flush-second")

    const stalls = (await records(logPath)).filter((record) => record.code === "renderer-runtime-stall")
    expect(stalls.map((record) => record.durationMs)).toEqual([1_200, 1_500])
  })

  it("导出时跳过截断记录并保留前后的有效记录", async () => {
    const { diagnostics, directory, logPath } = await createDiagnostics()
    const exportPath = path.join(path.dirname(logPath), "export.json")
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exportPath })

    await diagnostics.record("main", "before-corruption")
    await appendFile(logPath, "{\"code\":\"truncated\"")

    const restartedDiagnostics = new Diagnostics(directory)
    await restartedDiagnostics.initialize()
    await restartedDiagnostics.record("main", "after-corruption")
    await restartedDiagnostics.export()

    const exported = JSON.parse(await readFile(exportPath, "utf8")) as { events: Array<{ code: string }> }
    expect(exported.events.map((record) => record.code)).toEqual(["before-corruption", "after-corruption"])
  })

  it("日志中没有完整记录时清空截断内容", async () => {
    const { directory, logPath } = await createDiagnostics()
    const exportPath = path.join(path.dirname(logPath), "export-empty-tail.json")
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exportPath })
    await appendFile(logPath, "{\"code\":\"truncated\"")

    const restartedDiagnostics = new Diagnostics(directory)
    await restartedDiagnostics.initialize()
    await restartedDiagnostics.record("main", "first-complete-record")
    await restartedDiagnostics.export()

    const exported = JSON.parse(await readFile(exportPath, "utf8")) as { events: Array<{ code: string }> }
    expect(exported.events.map((record) => record.code)).toEqual(["first-complete-record"])
  })

  it("日志修复和 Crash Reporter 失败时仍完成初始化", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-diagnostics-failure-test-"))
    temporaryDirectories.push(directory)
    const logPath = path.join(directory, "diagnostics", "crashes.jsonl")
    await mkdir(logPath, { recursive: true })
    electronMocks.crashReporterStart.mockImplementationOnce(() => { throw new Error("crash reporter unavailable") })
    const diagnostics = new Diagnostics(directory)

    await expect(diagnostics.initialize()).resolves.toBeUndefined()
    await expect(diagnostics.record("main", "must-not-block-startup")).resolves.toBeUndefined()

    expect((await stat(logPath)).isDirectory()).toBe(true)
    expect(electronMocks.crashReporterStart).toHaveBeenCalledOnce()
  })
})

async function createDiagnostics(options: { maxLogBytes?: number; stallCooldownMs?: number } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-diagnostics-test-"))
  temporaryDirectories.push(directory)
  const diagnostics = new Diagnostics(directory, options)
  await diagnostics.initialize()
  return { diagnostics, directory, logPath: path.join(directory, "diagnostics", "crashes.jsonl") }
}

async function records(logPath: string): Promise<Array<{ code: string; durationMs?: number }>> {
  const content = await readFile(logPath, "utf8")
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { code: string; durationMs?: number })
}

function runtimeSnapshot(durationMs: number): RendererRuntimeSnapshot {
  return {
    activeRefreshes: 0,
    activeRequests: 0,
    data: { contacts: 0, conversations: 0, loadedConversations: 0, messages: 0, projects: 0 },
    eventLoopLagMs: durationMs,
    longTasks: { count: 1, maxDurationMs: durationMs },
    page: "chat",
  }
}
