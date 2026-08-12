import { describe, expect, it, vi } from "vitest"

import type { ResolvedClientUser } from "@/lib/client-data-api"
import { ClientUserDirectory } from "@/lib/client-user-directory"

function user(id: string, updatedAt = "2026-08-01T00:00:00.000Z"): ResolvedClientUser {
  return {
    avatar: "",
    email: `${id}@example.com`,
    id,
    lastOnlineAt: null,
    name: id,
    nickname: "",
    online: false,
    phone: "",
    type: "user",
    updatedAt,
  }
}

function deferred<T>() {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

describe("ClientUserDirectory", () => {
  it("micro-batches overlapping requests and reuses the pending user work", async () => {
    const resolveUsers = vi.fn(async (ids: readonly string[]) => ids.map((id) => user(id)))
    const directory = new ClientUserDirectory(resolveUsers, vi.fn())

    await Promise.all([
      directory.ensureUsers(["user-1", "user-2", "user-1", ""]),
      directory.ensureUsers(["user-2", "user-3"]),
    ])

    expect(resolveUsers).toHaveBeenCalledTimes(1)
    expect(resolveUsers).toHaveBeenCalledWith(
      ["user-1", "user-2", "user-3"],
      expect.any(AbortSignal),
    )
    expect(directory.getUsersById()).toEqual({
      "user-1": user("user-1"),
      "user-2": user("user-2"),
      "user-3": user("user-3"),
    })
  })

  it("splits more than one hundred IDs while preserving every caller", async () => {
    const first = deferred<ResolvedClientUser[]>()
    const second = deferred<ResolvedClientUser[]>()
    const resolveUsers = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const directory = new ClientUserDirectory(resolveUsers, vi.fn())
    const ids = Array.from({ length: 101 }, (_, index) => `user-${index + 1}`)
    const pending = directory.ensureUsers(ids)

    await Promise.resolve()
    expect(resolveUsers).toHaveBeenCalledTimes(1)
    expect(resolveUsers.mock.calls[0]?.[0]).toHaveLength(100)

    first.resolve(ids.slice(0, 100).map((id) => user(id)))
    await vi.waitFor(() => expect(resolveUsers).toHaveBeenCalledTimes(2))
    expect(resolveUsers.mock.calls[1]?.[0]).toEqual(["user-101"])

    second.resolve([user("user-101")])
    await pending
    expect(directory.getUser("user-101")).toEqual(user("user-101"))
  })

  it("uses profile and negative-result TTLs without suppressing a later retry", async () => {
    let now = 0
    const resolveUsers = vi.fn(async (ids: readonly string[]) =>
      ids.filter((id) => id !== "gone").map((id) => user(id)),
    )
    const directory = new ClientUserDirectory(resolveUsers, vi.fn(), () => now)

    await directory.ensureUsers(["known", "gone"])
    await directory.ensureUsers(["known", "gone"])
    expect(resolveUsers).toHaveBeenCalledTimes(1)

    now += 30_001
    await directory.ensureUsers(["known", "gone"])
    expect(resolveUsers).toHaveBeenCalledTimes(2)
    expect(resolveUsers.mock.calls[1]?.[0]).toEqual(["gone"])

    now += 5 * 60_000
    await directory.ensureUsers(["known"])
    expect(resolveUsers).toHaveBeenCalledTimes(3)
    expect(resolveUsers.mock.calls[2]?.[0]).toEqual(["known"])
  })

  it("rejects stale resolve writes after a newer profile invalidation", async () => {
    const oldRequest = deferred<ResolvedClientUser[]>()
    const freshRequest = deferred<ResolvedClientUser[]>()
    const resolveUsers = vi
      .fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => freshRequest.promise)
    let now = 0
    const directory = new ClientUserDirectory(resolveUsers, vi.fn(), () => now)
    directory.seed([user("user-1", "2026-08-01T00:00:00.000Z")])
    now = 10 * 60_000

    const stalePending = directory.ensureUsers(["user-1"])
    void stalePending.catch(() => undefined)
    await Promise.resolve()
    directory.invalidateUsers(["user-1"], "2026-08-03T00:00:00.000Z")
    await vi.waitFor(() => expect(resolveUsers).toHaveBeenCalledTimes(2))

    freshRequest.resolve([{ ...user("user-1", "2026-08-03T00:00:00.000Z"), name: "new profile" }])
    await Promise.resolve()
    oldRequest.resolve([user("user-1", "2026-08-02T00:00:00.000Z")])
    await Promise.resolve()

    expect(directory.getUser("user-1")?.name).toBe("new profile")
  })

  it("aborts outstanding work and prevents its result from crossing a cleared target", async () => {
    const request = deferred<ResolvedClientUser[]>()
    let signal: AbortSignal | undefined
    const resolveUsers = vi.fn((_ids: readonly string[], nextSignal: AbortSignal) => {
      signal = nextSignal
      return request.promise
    })
    const changes = vi.fn()
    const directory = new ClientUserDirectory(resolveUsers, changes)
    const pending = directory.ensureUsers(["user-1"])
    void pending.catch(() => undefined)

    await Promise.resolve()
    directory.clear()
    request.resolve([user("user-1")])
    await Promise.resolve()

    expect(signal?.aborted).toBe(true)
    expect(directory.getUsersById()).toEqual({})
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  it("can resolve profiles again after clearing an earlier target", async () => {
    const resolveUsers = vi.fn(async (ids: readonly string[]) => ids.map((id) => user(id)))
    const directory = new ClientUserDirectory(resolveUsers, vi.fn())

    await directory.ensureUsers(["user-1"])
    directory.clear()
    await directory.ensureUsers(["user-2"])

    expect(directory.getUsersById()).toEqual({ "user-2": user("user-2") })
    expect(resolveUsers).toHaveBeenCalledTimes(2)
  })
})
