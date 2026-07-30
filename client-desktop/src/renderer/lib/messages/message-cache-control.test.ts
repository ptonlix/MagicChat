import { describe, expect, it, vi } from "vitest"
import type { AuthenticatedTarget } from "@shared/client-contract"
import { clearManagedMessageCache, registerMessageCacheClearHandler } from "./message-cache-control"

const target: AuthenticatedTarget = {
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
  userId: "user-1",
}

describe("消息缓存清理协调器", () => {
  it("只调用当前认证目标注册的 Manager 清理", async () => {
    const clear = vi.fn().mockResolvedValue(undefined)
    const unregister = registerMessageCacheClearHandler(target, clear)

    await expect(clearManagedMessageCache(target)).resolves.toBe(true)
    await expect(clearManagedMessageCache({ ...target, userId: "user-2" })).resolves.toBe(false)
    expect(clear).toHaveBeenCalledOnce()

    unregister()
    await expect(clearManagedMessageCache(target)).resolves.toBe(false)
  })
})
