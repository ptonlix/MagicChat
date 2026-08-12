import { act, render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

const callbacks = new Map<string, (payload: unknown) => void>()
const invalidateUsers = vi.fn()
const refreshContacts = vi.fn().mockResolvedValue(undefined)
const refreshFriendRequests = vi.fn().mockResolvedValue(undefined)
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
    refreshContacts,
    refreshFriendRequests,
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
    refreshContacts.mockClear()
    refreshFriendRequests.mockClear()
    updateUserPresence.mockClear()
    realtimeReady = false
  })

  it("refreshes only an already-cached profile and patches valid presence", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )

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

  it("coalesces friend events only while contacts are visible", async () => {
    render(
      <MemoryRouter initialEntries={["/contacts/user/user-1"]}>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )

    act(() => {
      callbacks.get("friend.request.created")?.({})
      callbacks.get("contact.directory.mode.updated")?.({ mode: "unsupported" })
    })

    await Promise.resolve()
    expect(refreshContacts).not.toHaveBeenCalled()
    expect(refreshFriendRequests).not.toHaveBeenCalled()

    act(() => {
      callbacks.get("friend.request.created")?.({ request_id: "request-1" })
      callbacks.get("friendship.created")?.({})
      callbacks.get("contact.directory.mode.updated")?.({ mode: "friends" })
    })

    await waitFor(() => expect(refreshContacts).toHaveBeenCalledOnce())
    expect(refreshFriendRequests).toHaveBeenCalledOnce()
  })

  it("runs one trailing refresh when a friend event arrives during an active refresh", async () => {
    const contactsRefresh = createDeferred<void>()
    const friendRequestsRefresh = createDeferred<void>()
    refreshContacts.mockImplementationOnce(() => contactsRefresh.promise)
    refreshFriendRequests.mockImplementationOnce(() => friendRequestsRefresh.promise)

    render(
      <MemoryRouter initialEntries={["/contacts"]}>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )

    act(() => {
      callbacks.get("friend.request.created")?.({ request_id: "request-1" })
    })
    await waitFor(() => expect(refreshContacts).toHaveBeenCalledOnce())
    expect(refreshFriendRequests).toHaveBeenCalledOnce()

    act(() => {
      callbacks.get("friend.request.updated")?.({ request_id: "request-2" })
    })
    expect(refreshContacts).toHaveBeenCalledOnce()
    expect(refreshFriendRequests).toHaveBeenCalledOnce()

    await act(async () => {
      contactsRefresh.resolve()
      friendRequestsRefresh.resolve()
    })

    await waitFor(() => expect(refreshContacts).toHaveBeenCalledTimes(2))
    expect(refreshFriendRequests).toHaveBeenCalledTimes(2)
  })

  it("unsubscribes every handler on unmount", () => {
    const view = render(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )
    expect(callbacks.size).toBe(7)
    view.unmount()
    expect(callbacks.size).toBe(0)
  })

  it("invalidates cached users once per realtime-ready transition", () => {
    const view = render(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )

    realtimeReady = true
    view.rerender(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )
    expect(invalidateUsers).toHaveBeenCalledTimes(1)
    expect(invalidateUsers).toHaveBeenLastCalledWith(["user-1"])

    view.rerender(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )
    expect(invalidateUsers).toHaveBeenCalledTimes(1)

    realtimeReady = false
    view.rerender(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )
    realtimeReady = true
    view.rerender(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>,
    )
    expect(invalidateUsers).toHaveBeenCalledTimes(2)
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}
