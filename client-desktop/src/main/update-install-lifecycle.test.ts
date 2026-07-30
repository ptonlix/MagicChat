// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import {
  prepareUpdateInstall,
  type UpdateInstallLifecycleDependencies,
} from "./update-install-lifecycle"

describe("升级安装缓存生命周期", () => {
  it("等待缓存安全关闭后才完成安装准备，并在安装回滚时重开", async () => {
    const order: string[] = []
    const deps = lifecycleDependencies(order)

    const rollback = await prepareUpdateInstall(deps)

    expect(order).toEqual(["window:prepare", "cache:close"])
    rollback()
    await Promise.resolve()
    expect(order).toEqual(["window:prepare", "cache:close", "window:cancel", "cache:reopen"])
  })

  it("缓存关闭失败时恢复窗口退出态并等待缓存重开后报告准备失败", async () => {
    const order: string[] = []
    const deps = lifecycleDependencies(order)
    deps.messageCache.close = vi.fn(async () => {
      order.push("cache:close")
      throw new Error("checkpoint failed")
    })

    await expect(prepareUpdateInstall(deps)).rejects.toThrow("checkpoint failed")

    expect(order).toEqual(["window:prepare", "cache:close", "window:cancel", "cache:reopen"])
  })
})

function lifecycleDependencies(order: string[]): UpdateInstallLifecycleDependencies {
  return {
    messageCache: {
      close: vi.fn(async () => {
        order.push("cache:close")
      }),
      reopen: vi.fn(async () => {
        order.push("cache:reopen")
      }),
    },
    windows: {
      cancelPrepareToQuit: vi.fn(() => {
        order.push("window:cancel")
      }),
      prepareToQuit: vi.fn(() => {
        order.push("window:prepare")
      }),
    },
  }
}
