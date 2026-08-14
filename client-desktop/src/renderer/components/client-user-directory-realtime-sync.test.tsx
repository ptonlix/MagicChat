import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const callbacks = new Map<string, (payload: unknown) => void>()
const invalidateUsers = vi.fn()
const refreshFriendData = vi.fn().mockResolvedValue(undefined)
const updateUserPresence = vi.fn()
let realtimeReady = false

vi.mock("@/lib/realtime-context", () => ({
  useRealtime: () => ({
    ready: realtimeReady,
    subscribeRealtimeEvent: (event: string, callback: (payload: unknown) => void) => {
      callbacks.set(event, callback)
      return () => callbacks.delete(event)
    },
  }),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    invalidateUsers: (...args: Parameters<typeof invalidateUsers>) => invalidateUsers(...args),
    refreshFriendData,
    updateUserPresence,
    usersById: {
      "user-1": {
        avatar: "",
        email: "",
        id: "user-1",
        lastOnlineAt: null,
        name: "Alice",
        nickname: "",
        online: false,
        phone: "",
        type: "user",
      },
    },
  }),
}))

import { ClientUserDirectoryRealtimeSync } from "@/components/client-user-directory-realtime-sync"

describe("ClientUserDirectoryRealtimeSync", () => {
  beforeEach(() => {
    callbacks.clear()
    invalidateUsers.mockClear()
    refreshFriendData.mockReset()
    refreshFriendData.mockResolvedValue(undefined)
    updateUserPresence.mockClear()
    realtimeReady = false
  })

  it("只失效已缓存的资料并更新有效在线状态", () => {
    render(<ClientUserDirectoryRealtimeSync />)

    act(() => {
      callbacks.get("user.profile.updated")?.({
        updated_at: "2026-08-02T00:00:00.000Z",
        user_id: "user-1",
      })
      callbacks.get("user.profile.updated")?.({
        updated_at: "2026-08-02T00:00:00.000Z",
        user_id: "unknown",
      })
      callbacks.get("user.presence.updated")?.({
        last_online_at: "2026-08-02T00:00:00.000Z",
        online: true,
        user_id: "user-1",
      })
      callbacks.get("user.presence.updated")?.({ online: "yes", user_id: "user-1" })
    })

    expect(invalidateUsers).toHaveBeenCalledWith(["user-1"], "2026-08-02T00:00:00.000Z")
    expect(updateUserPresence).toHaveBeenCalledWith("user-1", true, "2026-08-02T00:00:00.000Z")
  })

  it("在聊天页也会仅刷新好友申请", async () => {
    render(<ClientUserDirectoryRealtimeSync />)

    act(() => {
      callbacks.get("friend.request.created")?.({ request_id: "request-1" })
    })

    await waitFor(() => expect(refreshFriendData).toHaveBeenCalledWith({ includeContacts: false }))
  })

  it("好友关系和目录模式事件优先请求目录后申请同步", async () => {
    render(<ClientUserDirectoryRealtimeSync />)

    act(() => {
      callbacks.get("friendship.deleted")?.({})
      callbacks.get("contact.directory.mode.updated")?.({ mode: "friends" })
    })

    await waitFor(() => expect(refreshFriendData).toHaveBeenCalledOnce())
    expect(refreshFriendData).toHaveBeenCalledWith({ includeContacts: true })
  })

  it("合并活跃刷新期间的事件，并至多追加一轮尾随刷新", async () => {
    const initialRefresh = createDeferred<void>()
    const trailingRefresh = createDeferred<void>()
    refreshFriendData.mockImplementationOnce(() => initialRefresh.promise)
    refreshFriendData.mockImplementationOnce(() => trailingRefresh.promise)
    render(<ClientUserDirectoryRealtimeSync />)

    act(() => {
      callbacks.get("friend.request.created")?.({ request_id: "request-1" })
    })
    await waitFor(() => expect(refreshFriendData).toHaveBeenCalledOnce())
    expect(refreshFriendData).toHaveBeenLastCalledWith({ includeContacts: false })

    act(() => {
      callbacks.get("friend.request.updated")?.({ request_id: "request-2" })
      callbacks.get("friendship.created")?.({ request_id: "request-2" })
    })

    await act(async () => {
      initialRefresh.resolve()
    })
    await waitFor(() => expect(refreshFriendData).toHaveBeenCalledTimes(2))
    expect(refreshFriendData).toHaveBeenLastCalledWith({ includeContacts: true })

    await act(async () => {
      trailingRefresh.resolve()
    })
    expect(refreshFriendData).toHaveBeenCalledTimes(2)
  })

  it("忽略畸形事件并吞掉单次同步失败", async () => {
    refreshFriendData.mockRejectedValueOnce(new Error("请求失败"))
    render(<ClientUserDirectoryRealtimeSync />)

    act(() => {
      callbacks.get("friend.request.created")?.({})
      callbacks.get("friendship.created")?.({ request_id: "" })
      callbacks.get("contact.directory.mode.updated")?.({ mode: "unsupported" })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(refreshFriendData).not.toHaveBeenCalled()

    act(() => {
      callbacks.get("friend.request.updated")?.({ request_id: "request-1" })
    })
    await waitFor(() => expect(refreshFriendData).toHaveBeenCalledOnce())
  })

  it("在每个 realtime ready 周期补偿同步并失效缓存用户", async () => {
    const view = render(<ClientUserDirectoryRealtimeSync />)

    realtimeReady = true
    view.rerender(<ClientUserDirectoryRealtimeSync />)
    expect(invalidateUsers).toHaveBeenCalledWith(["user-1"])
    await waitFor(() => expect(refreshFriendData).toHaveBeenCalledOnce())
    expect(refreshFriendData).toHaveBeenLastCalledWith({ includeContacts: true })

    view.rerender(<ClientUserDirectoryRealtimeSync />)
    expect(invalidateUsers).toHaveBeenCalledTimes(1)

    realtimeReady = false
    view.rerender(<ClientUserDirectoryRealtimeSync />)
    realtimeReady = true
    view.rerender(<ClientUserDirectoryRealtimeSync />)
    await waitFor(() => expect(refreshFriendData).toHaveBeenCalledTimes(2))
    expect(invalidateUsers).toHaveBeenCalledTimes(2)
  })

  it("卸载时清理全部 realtime 订阅", () => {
    const view = render(<ClientUserDirectoryRealtimeSync />)
    expect(callbacks.size).toBe(7)
    view.unmount()
    expect(callbacks.size).toBe(0)
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}
