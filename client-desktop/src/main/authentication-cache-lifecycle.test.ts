// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { handleUnauthorizedCacheLifecycle } from "./authentication-cache-lifecycle"

const target = {
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
  userId: "user-1",
}

describe("认证失效缓存生命周期", () => {
  it("立即关闭实时并广播，缓存清理失败不会形成未处理拒绝", async () => {
    const order: string[] = []
    const clearUser = vi.fn(async () => {
      order.push("clear")
      throw new Error("cache unavailable")
    })

    handleUnauthorizedCacheLifecycle(target, {
      broadcastUnauthorized: () => order.push("broadcast"),
      clearUser,
      closeRealtime: () => order.push("close"),
    })

    expect(order).toEqual(["close", "broadcast", "clear"])
    await Promise.resolve()
    await Promise.resolve()
    expect(clearUser).toHaveBeenCalledWith(target)
  })

  it("缓存清理同步抛错也不阻止未授权广播", () => {
    const broadcastUnauthorized = vi.fn()

    expect(() =>
      handleUnauthorizedCacheLifecycle(target, {
        broadcastUnauthorized,
        clearUser: () => {
          throw new Error("profile unavailable")
        },
        closeRealtime: vi.fn(),
      }),
    ).not.toThrow()
    expect(broadcastUnauthorized).toHaveBeenCalledWith(target)
  })
})
