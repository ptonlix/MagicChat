import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { startStaggeredRefresh } from "@/lib/staggered-refresh"

describe("startStaggeredRefresh", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("在一个刷新周期内错峰执行所有任务", async () => {
    const tasks = Array.from({ length: 4 }, () => vi.fn())
    const controller = startStaggeredRefresh(tasks, 16_000)

    await vi.advanceTimersByTimeAsync(3_999)
    expect(tasks.every((task) => task.mock.calls.length === 0)).toBe(true)

    for (let index = 0; index < tasks.length; index += 1) {
      await vi.advanceTimersByTimeAsync(index === 0 ? 1 : 4_000)
      expect(tasks[index]).toHaveBeenCalledOnce()
    }
    controller.stop()
  })

  it("上一次同类刷新未结束时不重复执行", async () => {
    let finishFirst!: () => void
    const first = vi.fn(() => new Promise<void>((resolve) => { finishFirst = resolve }))
    const second = vi.fn()
    const controller = startStaggeredRefresh([first, second], 2_000)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()

    finishFirst()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(first).toHaveBeenCalledTimes(2)
    controller.stop()
  })

  it("停止后不再执行任务", async () => {
    const task = vi.fn()
    const controller = startStaggeredRefresh([task], 1_000)
    controller.stop()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(task).not.toHaveBeenCalled()
  })
})
