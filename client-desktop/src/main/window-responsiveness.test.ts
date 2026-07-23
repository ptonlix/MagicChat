import { EventEmitter } from "node:events"
import type { BrowserWindow } from "electron"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Diagnostics } from "@main/diagnostics"
import { monitorWindowResponsiveness } from "@main/window-responsiveness"

const electronMocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
}))

vi.mock("electron", () => ({
  dialog: { showMessageBox: electronMocks.showMessageBox },
}))

class FakeWindow extends EventEmitter {
  destroyed = false
  webContents = { reload: vi.fn() }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

describe("monitorWindowResponsiveness", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    electronMocks.showMessageBox.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("记录短时无响应及恢复耗时，但不弹出提示", () => {
    const window = new FakeWindow()
    const recordRendererLifecycle = vi.fn().mockResolvedValue(undefined)
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { recordRendererLifecycle } as unknown as Diagnostics,
      8_000
    )

    window.emit("unresponsive")
    vi.advanceTimersByTime(2_500)
    window.emit("responsive")

    expect(recordRendererLifecycle).toHaveBeenNthCalledWith(1, "unresponsive", expect.any(String))
    expect(recordRendererLifecycle).toHaveBeenNthCalledWith(2, "responsive", expect.any(String), 2_500)
    expect(recordRendererLifecycle.mock.calls[0][1]).toBe(recordRendererLifecycle.mock.calls[1][1])
    expect(electronMocks.showMessageBox).not.toHaveBeenCalled()
  })

  it("持续无响应超过阈值后异步提示，并允许重新加载", async () => {
    const window = new FakeWindow()
    const recordRendererLifecycle = vi.fn().mockResolvedValue(undefined)
    electronMocks.showMessageBox.mockResolvedValue({ response: 1 })
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { recordRendererLifecycle } as unknown as Diagnostics,
      8_000
    )

    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)

    expect(electronMocks.showMessageBox).toHaveBeenCalledOnce()
    expect(window.webContents.reload).toHaveBeenCalledOnce()
    expect(recordRendererLifecycle.mock.calls.map((call) => call[0])).toEqual([
      "unresponsive",
      "unresponsive-prompt",
      "unresponsive-reload",
    ])
  })

  it("恢复响应时取消已经显示的异步提示", async () => {
    const window = new FakeWindow()
    electronMocks.showMessageBox.mockReturnValue(new Promise(() => undefined))
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { recordRendererLifecycle: vi.fn().mockResolvedValue(undefined) } as unknown as Diagnostics,
      8_000
    )

    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)
    const options = electronMocks.showMessageBox.mock.calls[0][1]
    expect(options.signal.aborted).toBe(false)

    window.emit("responsive")
    expect(options.signal.aborted).toBe(true)
  })

  it("旧对话框结算时不影响新的无响应周期", async () => {
    const window = new FakeWindow()
    const recordRendererLifecycle = vi.fn().mockResolvedValue(undefined)
    let resolveFirst!: (result: { response: number }) => void
    electronMocks.showMessageBox
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise(() => undefined))
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { recordRendererLifecycle } as unknown as Diagnostics,
      8_000
    )

    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)
    const firstEpisodeId = recordRendererLifecycle.mock.calls[0][1]
    window.emit("responsive")
    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)
    const secondEpisodeId = recordRendererLifecycle.mock.calls[3][1]

    resolveFirst({ response: 1 })
    await Promise.resolve()

    expect(secondEpisodeId).not.toBe(firstEpisodeId)
    expect(window.webContents.reload).not.toHaveBeenCalled()
    expect(recordRendererLifecycle).not.toHaveBeenCalledWith(
      "unresponsive-reload",
      firstEpisodeId,
      expect.any(Number)
    )
  })
})
