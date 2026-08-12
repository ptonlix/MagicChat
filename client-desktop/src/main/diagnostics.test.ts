import { appendFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Diagnostics, type DiagnosticRecord } from "@main/diagnostics"
import type { RendererRuntimeSnapshot } from "@shared/bridge"

const electronMocks = vi.hoisted(() => ({ crashReporterStart: vi.fn(), showSaveDialog: vi.fn() }))

vi.mock("electron", () => ({
  app: {
    getAppMetrics: () => [
      { cpu: { percentCPUUsage: 12 }, memory: { workingSetSize: 2048 }, type: "Renderer" },
    ],
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
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it("串行写入并由 Main 持久分配递增 eventSeq", async () => {
    const { diagnostics, logPath } = await createDiagnostics()

    await Promise.all([
      diagnostics.recordEvent(realtimeState("connecting", 1)),
      diagnostics.recordEvent(realtimeState("connected", 2)),
      diagnostics.recordEvent(realtimeState("reconnecting", 3)),
    ])

    expect((await records(logPath)).map((record) => record.eventSeq)).toEqual([1, 2, 3])
    expect((await records(logPath)).map((record) => record.data?.attempt)).toEqual([1, 2, 3])
  })

  it("重复解析失败聚合使用 Main 分配的结束 eventSeq", async () => {
    const { diagnostics, logPath } = await createDiagnostics()

    await diagnostics.recordEvent({
      data: { error: { category: "parse", phase: "request" } },
      origin: "renderer",
      type: "realtime.event-parse-failed",
    })
    const aggregated = await diagnostics.recordEvent({
      data: {
        suppressedCount: 3,
        suppressedFromEventSeq: 1,
        suppressedToEventSeq: 0,
        windowEndedAt: "2025-01-01T00:00:30.000Z",
        windowStartedAt: "2025-01-01T00:00:00.000Z",
      },
      origin: "renderer",
      type: "realtime.parse-failures-aggregated",
    })

    expect(aggregated).toMatchObject({ eventSeq: 2, data: { suppressedToEventSeq: 2 } })
    expect((await records(logPath))[1]).toMatchObject({
      eventSeq: 2,
      data: { suppressedToEventSeq: 2 },
    })
  })

  it("超过大小限制后只保留当前文件和一个轮转文件", async () => {
    const { diagnostics, logPath } = await createDiagnostics({ maxLogBytes: 500 })

    for (let index = 0; index < 12; index += 1) {
      await diagnostics.recordEvent(realtimeState("connected", index))
    }

    const rotatedPath = `${logPath}.1`
    expect((await stat(logPath)).size).toBeLessThanOrEqual(500)
    expect((await stat(rotatedPath)).size).toBeLessThanOrEqual(500)
    expect((await records(logPath)).at(-1)?.data?.attempt).toBe(11)
  })

  it("统计当前和轮转诊断日志的聚合大小", async () => {
    const { diagnostics, logPath } = await createDiagnostics({ maxLogBytes: 500 })

    for (let index = 0; index < 12; index += 1)
      await diagnostics.recordEvent(realtimeState("connected", index))

    const expectedBytes = (
      await Promise.all(
        [logPath, `${logPath}.1`].map((filePath) => stat(filePath).then((file) => file.size)),
      )
    ).reduce((total, size) => total + size, 0)

    await expect(diagnostics.getStorageStats()).resolves.toEqual({
      bytes: expectedBytes,
      status: "available",
    })
  })

  it("清理排在写入队列之后，保留导出文件与递增的事件序号", async () => {
    const { diagnostics, logPath } = await createDiagnostics()
    const exportedPath = path.join(path.dirname(logPath), "exported-diagnostics.json")
    await appendFile(exportedPath, "exported package")

    const recorded = diagnostics.recordEvent(realtimeState("connected", 1))
    const cleared = diagnostics.clearStorage()
    await Promise.all([recorded, cleared])

    await expect(diagnostics.getStorageStats()).resolves.toEqual({ bytes: 0, status: "available" })
    await expect(readFile(exportedPath, "utf8")).resolves.toBe("exported package")

    const afterClear = await diagnostics.recordEvent(realtimeState("connected", 2))
    expect(afterClear?.eventSeq).toBe(2)
    expect((await records(logPath)).map((record) => record.eventSeq)).toEqual([2])
  })

  it("冷却周期内只补写最大的一次运行时卡顿", async () => {
    vi.useFakeTimers()
    const { diagnostics, logPath } = await createDiagnostics({ stallCooldownMs: 30_000 })

    diagnostics.updateRuntimeSnapshot(runtimeSnapshot(1_200))
    diagnostics.updateRuntimeSnapshot(runtimeSnapshot(1_500))
    diagnostics.updateRuntimeSnapshot(runtimeSnapshot(1_300))
    await diagnostics.recordEvent(realtimeState("connected", 1))
    await vi.advanceTimersByTimeAsync(30_000)
    await diagnostics.recordEvent(realtimeState("connected", 2))

    const stalls = (await records(logPath)).filter(
      (record) => record.type === "runtime.stall-observed",
    )
    expect(stalls.map((record) => record.data?.durationMs)).toEqual([1_200, 1_500])
  })

  it("导出两个文件中的所有有效记录而不是截断至 200 条", async () => {
    const { diagnostics, logPath } = await createDiagnostics()
    const exportPath = path.join(path.dirname(logPath), "export.json")
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exportPath })

    for (let index = 0; index < 201; index += 1)
      await diagnostics.recordEvent(realtimeState("connected", index))

    await diagnostics.export()

    const exported = await readExport(exportPath)
    expect(exported.events).toHaveLength(201)
    expect(exported.events.map((record) => record.eventSeq)).toEqual(
      Array.from({ length: 201 }, (_, index) => index + 1),
    )
    expect(exported.timeline.eventCount).toBe(201)
    expect(exported.summary.eventTypes["realtime.state-changed"]).toBe(201)
    expect(exported.remoteTelemetryEnabled).toBe(false)
  })

  it("导出时跳过截断记录并保留前后的有效记录", async () => {
    const { diagnostics, directory, logPath } = await createDiagnostics()
    const exportPath = path.join(path.dirname(logPath), "export.json")
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exportPath })

    await diagnostics.recordEvent(realtimeState("connecting", 1))
    await appendFile(logPath, '{"eventSeq":')

    const restartedDiagnostics = new Diagnostics(directory)
    await restartedDiagnostics.initialize()
    await restartedDiagnostics.recordEvent(realtimeState("connected", 2))
    await restartedDiagnostics.export()

    const exported = await readExport(exportPath)
    expect(exported.events.map((record) => record.eventSeq)).toEqual([1, 2])
  })

  it("初始化时精准清除旧诊断文件且不影响新日志", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-diagnostics-migration-test-"))
    temporaryDirectories.push(directory)
    const diagnosticsDirectory = path.join(directory, "diagnostics")
    const legacyPath = path.join(diagnosticsDirectory, "crashes.jsonl")
    const legacyRotatedPath = `${legacyPath}.1`
    const unrelatedPath = path.join(diagnosticsDirectory, "keep.json")
    await mkdir(diagnosticsDirectory, { recursive: true })
    await Promise.all([
      appendFile(legacyPath, "obsolete diagnostic record\n"),
      appendFile(legacyRotatedPath, "obsolete rotated diagnostic record\n"),
      appendFile(unrelatedPath, "preserve this file\n"),
    ])

    const diagnostics = new Diagnostics(directory)
    await diagnostics.initialize()
    await diagnostics.recordEvent(realtimeState("connected", 1))

    await expect(stat(legacyPath)).rejects.toThrow()
    await expect(stat(legacyRotatedPath)).rejects.toThrow()
    await expect(readFile(unrelatedPath, "utf8")).resolves.toBe("preserve this file\n")
    await expect(
      readFile(path.join(diagnosticsDirectory, "realtime.jsonl"), "utf8"),
    ).resolves.toContain('"eventSeq":1')
  })

  it("重启后基于同一时间线导出相同的连接汇总", async () => {
    const { diagnostics, directory, logPath } = await createDiagnostics()
    const firstExportPath = path.join(path.dirname(logPath), "summary-first.json")
    const secondExportPath = path.join(path.dirname(logPath), "summary-second.json")
    await diagnostics.recordEvent({
      data: { closeCode: 1006 },
      origin: "main",
      type: "realtime.socket-closed",
    })
    await diagnostics.recordEvent({
      data: { attempt: 1 },
      origin: "main",
      type: "realtime.reconnect-scheduled",
    })
    await diagnostics.recordEvent({
      data: { ready: true },
      origin: "main",
      type: "realtime.system-ready",
    })
    await diagnostics.recordEvent({
      data: { responseStatus: 401 },
      origin: "main",
      type: "realtime.authorization-checked",
    })
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: firstExportPath,
    })
    await diagnostics.export()

    const restartedDiagnostics = new Diagnostics(directory)
    await restartedDiagnostics.initialize()
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: secondExportPath,
    })
    await restartedDiagnostics.export()

    const first = await readExport(firstExportPath)
    const second = await readExport(secondExportPath)
    expect(second.summary).toEqual(first.summary)
    expect(first.summary.connectionCounters).toEqual({
      authorizationFailures: 1,
      closes: 1,
      reconnects: 1,
      systemReady: 1,
    })
  })

  it("日志修复和 Crash Reporter 失败时仍完成初始化", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-diagnostics-failure-test-"))
    temporaryDirectories.push(directory)
    const logPath = path.join(directory, "diagnostics", "realtime.jsonl")
    await mkdir(logPath, { recursive: true })
    electronMocks.crashReporterStart.mockImplementationOnce(() => {
      throw new Error("crash reporter unavailable")
    })
    const diagnostics = new Diagnostics(directory)

    await expect(diagnostics.initialize()).resolves.toBeUndefined()
    await expect(diagnostics.recordEvent(realtimeState("connected", 1))).resolves.toBeUndefined()

    expect((await stat(logPath)).isDirectory()).toBe(true)
    expect(electronMocks.crashReporterStart).toHaveBeenCalledOnce()
  })

  it("诊断日志不可清理时返回失败且统计标记为不可用", async () => {
    const { diagnostics, logPath } = await createDiagnostics()
    await rm(logPath, { force: true })
    await mkdir(logPath, { recursive: true })

    await expect(diagnostics.clearStorage()).rejects.toThrow()
    await expect(diagnostics.getStorageStats()).resolves.toEqual({
      bytes: 0,
      status: "unavailable",
    })
  })
})

async function createDiagnostics(options: { maxLogBytes?: number; stallCooldownMs?: number } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-diagnostics-test-"))
  temporaryDirectories.push(directory)
  const diagnostics = new Diagnostics(directory, options)
  await diagnostics.initialize()
  return { diagnostics, directory, logPath: path.join(directory, "diagnostics", "realtime.jsonl") }
}

async function records(logPath: string): Promise<DiagnosticRecord[]> {
  const content = await readFile(logPath, "utf8")
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DiagnosticRecord)
}

async function readExport(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as {
    events: DiagnosticRecord[]
    remoteTelemetryEnabled: boolean
    summary: {
      connectionCounters: Record<string, number>
      eventTypes: Record<string, number>
    }
    timeline: { eventCount: number }
  }
}

function realtimeState(status: "connected" | "connecting" | "reconnecting", attempt: number) {
  return {
    context: {
      connectionInstanceId: "connection-1",
      episodeId: "episode-1",
      targetScope: "server-1",
    },
    data: { attempt, ready: false, status },
    origin: "main" as const,
    type: "realtime.state-changed" as const,
  }
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
