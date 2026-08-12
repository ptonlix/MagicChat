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
    const recordEvent = vi.fn().mockResolvedValue(undefined)
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { recordEvent } as unknown as Diagnostics,
      8_000,
    )

    window.emit("unresponsive")
    vi.advanceTimersByTime(2_500)
    window.emit("responsive")

    expect(recordEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        context: { episodeId: expect.any(String) },
        data: { windowResponsivenessPhase: "detected" },
        type: "window.unresponsive",
      }),
    )
    expect(recordEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { durationMs: 2_500, windowResponsivenessPhase: "recovered" },
        type: "window.unresponsive",
      }),
    )
    expect(recordEvent.mock.calls[0][0].context.episodeId).toBe(
      recordEvent.mock.calls[1][0].context.episodeId,
    )
    expect(electronMocks.showMessageBox).not.toHaveBeenCalled()
  })

  it("持续无响应超过阈值后异步提示，并允许重新加载", async () => {
    const window = new FakeWindow()
    const recordEvent = vi.fn().mockResolvedValue(undefined)
    electronMocks.showMessageBox.mockResolvedValue({ response: 1 })
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { recordEvent } as unknown as Diagnostics,
      8_000,
    )

    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)

    expect(electronMocks.showMessageBox).toHaveBeenCalledOnce()
    expect(window.webContents.reload).toHaveBeenCalledOnce()
    expect(recordEvent.mock.calls.map((call) => call[0].data.windowResponsivenessPhase)).toEqual([
      "detected",
      "prompted",
      "reloaded",
    ])
  })

  it("恢复响应时取消已经显示的异步提示", async () => {
    const window = new FakeWindow()
    electronMocks.showMessageBox.mockReturnValue(new Promise(() => undefined))
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { recordEvent: vi.fn().mockResolvedValue(undefined) } as unknown as Diagnostics,
      8_000,
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
    const recordEvent = vi.fn().mockResolvedValue(undefined)
    let resolveFirst!: (result: { response: number }) => void
    electronMocks.showMessageBox
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockReturnValueOnce(new Promise(() => undefined))
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { recordEvent } as unknown as Diagnostics,
      8_000,
    )

    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)
    const firstEpisodeId = recordEvent.mock.calls[0][0].context.episodeId
    window.emit("responsive")
    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)
    const secondEpisodeId = recordEvent.mock.calls[3][0].context.episodeId

    resolveFirst({ response: 1 })
    await Promise.resolve()

    expect(secondEpisodeId).not.toBe(firstEpisodeId)
    expect(window.webContents.reload).not.toHaveBeenCalled()
    expect(recordEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        context: { episodeId: firstEpisodeId },
        data: expect.objectContaining({ windowResponsivenessPhase: "reloaded" }),
      }),
    )
  })
})
