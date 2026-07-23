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
    const record = vi.fn().mockResolvedValue(undefined)
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { record } as unknown as Diagnostics,
      8_000
    )

    window.emit("unresponsive")
    vi.advanceTimersByTime(2_500)
    window.emit("responsive")

    expect(record).toHaveBeenNthCalledWith(1, "renderer", "unresponsive")
    expect(record).toHaveBeenNthCalledWith(2, "renderer", "responsive", {
      durationMs: 2_500,
    })
    expect(electronMocks.showMessageBox).not.toHaveBeenCalled()
  })

  it("持续无响应超过阈值后异步提示，并允许重新加载", async () => {
    const window = new FakeWindow()
    electronMocks.showMessageBox.mockResolvedValue({ response: 1 })
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { record: vi.fn().mockResolvedValue(undefined) } as unknown as Diagnostics,
      8_000
    )

    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)

    expect(electronMocks.showMessageBox).toHaveBeenCalledOnce()
    expect(window.webContents.reload).toHaveBeenCalledOnce()
  })

  it("恢复响应时取消已经显示的异步提示", async () => {
    const window = new FakeWindow()
    electronMocks.showMessageBox.mockReturnValue(new Promise(() => undefined))
    monitorWindowResponsiveness(
      window as unknown as BrowserWindow,
      { record: vi.fn().mockResolvedValue(undefined) } as unknown as Diagnostics,
      8_000
    )

    window.emit("unresponsive")
    await vi.advanceTimersByTimeAsync(8_000)
    const options = electronMocks.showMessageBox.mock.calls[0][1]
    expect(options.signal.aborted).toBe(false)

    window.emit("responsive")
    expect(options.signal.aborted).toBe(true)
  })
})
