import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdaterAdapter, UpdaterClock } from "@main/updater-service"

vi.mock("electron", () => ({
  app: { getVersion: () => "1.0.0", isPackaged: true },
  shell: { openExternal: vi.fn() },
}))
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      allowDowngrade: false,
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
      quitAndInstall: vi.fn(),
    },
  },
}))

const { UpdaterService, classifyUpdateError, sanitizeReleaseNotes } =
  await import("@main/updater-service")

describe("UpdaterService", () => {
  let adapter: FakeUpdater
  let clock: FakeClock

  beforeEach(() => {
    adapter = new FakeUpdater()
    clock = new FakeClock()
  })

  it("固定默认通道语义并复用进行中的检查", async () => {
    const pending = deferred<unknown>()
    adapter.checkResult = pending.promise
    const service = createService(adapter, clock)
    const first = service.check()
    const second = service.check()
    expect(first).toBe(second)
    expect(adapter.checkCalls).toBe(1)
    expect(adapter.allowDowngrade).toBe(false)
    expect(adapter.allowPrerelease).toBe(false)
    pending.resolve(undefined)
    await first
  })

  it("清理发布说明并保持下载进度单调", async () => {
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-available", {
      releaseNotes: "<b>修复</b> https://evil.example/token\u0000",
      version: "1.1.0",
    })
    await check
    expect(service.current()).toMatchObject({
      releaseNotes: "修复 [链接已移除]",
      status: "available",
      targetVersion: "1.1.0",
    })
    const download = service.download()
    adapter.emit("download-progress", { percent: 60 })
    adapter.emit("download-progress", { percent: 20 })
    expect(service.current().progress).toBe(60)
    adapter.emit("update-downloaded", { version: "1.1.0" })
    await download
    expect(service.current()).toMatchObject({ progress: 100, status: "downloaded" })
  })

  it("拒绝乱序事件并在错误后使用不少于 15 分钟的退避", async () => {
    const service = createService(adapter, clock)
    adapter.emit("update-downloaded", { version: "1.1.0" })
    expect(service.current().status).toBe("idle")
    adapter.checkResult = Promise.reject(new Error("status code 429"))
    await service.check()
    expect(service.current()).toMatchObject({ errorCode: "rate_limited", status: "error" })
    expect(clock.delays.at(-1)).toBe(15 * 60_000)
  })

  it("无更新后恢复 idle 并安排 6 小时轮询", async () => {
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-not-available")
    await check
    expect(service.current().status).toBe("idle")
    expect(clock.delays.at(-1)).toBe(6 * 60 * 60_000)
  })

  it("下载失败保持当前版本并进入可重试错误", async () => {
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-available", { version: "1.1.0" })
    await check
    adapter.downloadResult = Promise.reject(new Error("checksum mismatch"))
    await service.download()
    expect(service.current()).toMatchObject({
      currentVersion: "1.0.0",
      errorCode: "checksum_invalid",
      retryable: true,
      status: "error",
    })
  })

  it("安装前阻止活跃传输并保证 quitAndInstall 顺序", async () => {
    let active = true
    const order: string[] = []
    adapter.quitAndInstall = () => order.push("quit")
    const service = createService(adapter, clock, {
      hasActiveTransfers: () => active,
      prepareInstall: async () => {
        order.push("prepare")
      },
    })
    const check = service.check()
    adapter.emit("update-available", { version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { version: "1.1.0" })
    await download
    await expect(service.install()).resolves.toEqual({
      reason: "active_transfers",
      status: "blocked",
    })
    active = false
    await expect(service.install()).resolves.toEqual({ status: "started" })
    expect(order).toEqual(["prepare", "quit"])
    expect(service.isInstallIntent()).toBe(true)
    await expect(service.install()).resolves.toEqual({
      reason: "not_downloaded",
      status: "blocked",
    })
  })

  it("安装准备失败后恢复为可重试错误状态", async () => {
    const service = createService(adapter, clock, {
      prepareInstall: () => Promise.reject(new Error("permission denied")),
    })
    const check = service.check()
    adapter.emit("update-available", { version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { version: "1.1.0" })
    await download
    await expect(service.install()).resolves.toEqual({
      reason: "prepare_failed",
      status: "failed",
    })
    expect(service.current()).toMatchObject({
      errorCode: "permission_denied",
      retryable: true,
      status: "error",
    })
    expect(service.isInstallIntent()).toBe(false)
  })

  it.each([
    ["win32", undefined],
    ["darwin", undefined],
    ["linux", "/tmp/MagicChat.AppImage"],
  ] as const)("在 %s 按准备、quitAndInstall 顺序安装", async (platform, appImagePath) => {
    const order: string[] = []
    adapter.quitAndInstall = () => order.push("quit")
    const service = createService(adapter, clock, {
      context: {
        appImagePath,
        arch: "x64",
        channel: "stable",
        currentVersion: "1.0.0",
        packaged: true,
        platform,
      },
      prepareInstall: async () => {
        order.push("prepare")
      },
    })
    const check = service.check()
    adapter.emit("update-available", { version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { version: "1.1.0" })
    await download
    await expect(service.install()).resolves.toEqual({ status: "started" })
    expect(order).toEqual(["prepare", "quit"])
  })

  it("dispose 清理定时器和 updater 监听器", () => {
    const service = createService(adapter, clock)
    service.dispose()
    expect(clock.cleared).toBe(1)
    expect(adapter.offCalls).toBe(6)
  })
})

describe("更新内容归一化", () => {
  it("分类稳定错误码", () => {
    expect(classifyUpdateError(new Error("ENOSPC: no space"))).toBe("disk_full")
    expect(classifyUpdateError(new Error("checksum mismatch"))).toBe("checksum_invalid")
    expect(classifyUpdateError(new Error("Gatekeeper signature"))).toBe(
      "platform_signature_required",
    )
  })

  it("限制发布说明长度且不保留 HTML 和 URL", () => {
    const notes = sanitizeReleaseNotes(`<p>${"a".repeat(5_000)}</p> https://example.com`)
    expect(notes).toHaveLength(4_000)
    expect(notes).not.toContain("<p>")
    expect(notes).not.toContain("https://")
  })
})

function createService(
  adapter: FakeUpdater,
  clock: FakeClock,
  overrides: Partial<ConstructorParameters<typeof UpdaterService>[0]> = {},
) {
  return new UpdaterService({
    adapter,
    clock,
    context: {
      arch: "x64",
      channel: "stable",
      currentVersion: "1.0.0",
      packaged: true,
      platform: "win32",
    },
    ...overrides,
  })
}

class FakeUpdater implements UpdaterAdapter {
  allowDowngrade = true
  allowPrerelease = true
  autoDownload = true
  autoInstallOnAppQuit = true
  checkCalls = 0
  checkResult: Promise<unknown> = Promise.resolve(undefined)
  downloadResult: Promise<unknown> = Promise.resolve(undefined)
  offCalls = 0
  private readonly listeners = new Map<string, Set<(payload?: unknown) => void>>()

  checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1
    return this.checkResult
  }

  downloadUpdate(): Promise<unknown> {
    return this.downloadResult
  }

  on(event: string, listener: (payload?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event: string, listener: (payload?: unknown) => void): void {
    this.offCalls += 1
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }

  quitAndInstall(): void {}
}

class FakeClock implements UpdaterClock {
  cleared = 0
  delays: number[] = []

  clearTimeout(timer: ReturnType<typeof setTimeout>): void {
    this.cleared += 1
    clearTimeout(timer)
  }

  random(): number {
    return 0
  }

  setTimeout(_callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    this.delays.push(delay)
    const timer = setTimeout(() => undefined, 60_000)
    timer.unref()
    return timer
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
