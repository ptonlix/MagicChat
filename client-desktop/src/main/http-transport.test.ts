// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { isPackaged: false } }))

import type { AuthenticatedTarget, ClientRequest } from "@shared/client-contract"
import { HttpTransport } from "./http-transport"

const target: AuthenticatedTarget = {
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
  userId: "user-1",
}
const request: ClientRequest = {
  method: "GET",
  path: "/api/client/me",
  requestId: "same-id",
  timeoutMs: 30_000,
}

describe("HttpTransport 取消隔离", () => {
  let pendingFetches: Array<ReturnType<typeof deferred<Response>>>
  let transport: HttpTransport

  beforeEach(() => {
    pendingFetches = []
    const profiles = {
      recordUser: vi.fn(),
      require: vi.fn(() => ({ id: target.id, normalizedUrl: target.normalizedUrl })),
    }
    const sessions = {
      for: vi.fn(() => ({
        fetch: vi.fn((_url: string, init: RequestInit) => {
          const pending = deferred<Response>()
          init.signal?.addEventListener("abort", () =>
            pending.reject(new DOMException("aborted", "AbortError")),
          )
          pendingFetches.push(pending)
          return pending.promise
        }),
      })),
    }
    transport = new HttpTransport(profiles as never, sessions as never)
  })

  it("允许不同 owner 使用相同 requestId，且只能取消自身请求", async () => {
    const ownerOne = transport.request(1, target, request)
    const ownerTwo = transport.request(2, target, request)
    await vi.waitFor(() => expect(pendingFetches).toHaveLength(2))

    transport.cancel(request.requestId, 1)
    pendingFetches[1]!.resolve(jsonResponse({ success: true }))
    await expect(ownerOne).rejects.toMatchObject({ code: "aborted" })
    await expect(ownerTwo).resolves.toMatchObject({ status: 200 })
    transport.cancel(request.requestId, 1)
    transport.cancel("unknown", 1)
  })

  it("拒绝同 owner 的在途重复 ID", async () => {
    const first = transport.request(1, target, request)
    await vi.waitFor(() => expect(pendingFetches).toHaveLength(1))
    await expect(transport.request(1, target, request)).rejects.toMatchObject({
      code: "invalid_request",
    })
    transport.cancelOwner(1)
    await expect(first).rejects.toMatchObject({ code: "aborted" })
  })

  it("按 target、server 和 all 幂等终止请求", async () => {
    const first = transport.request(1, target, { ...request, requestId: "one" })
    const second = transport.request(2, target, { ...request, requestId: "two" })
    await vi.waitFor(() => expect(pendingFetches).toHaveLength(2))
    transport.cancelTarget(target)
    await expect(first).rejects.toMatchObject({ code: "aborted" })
    await expect(second).rejects.toMatchObject({ code: "aborted" })

    const third = transport.request(1, target, { ...request, requestId: "three" })
    await vi.waitFor(() => expect(pendingFetches).toHaveLength(3))
    transport.cancelServer(target.id)
    await expect(third).rejects.toMatchObject({ code: "aborted" })

    const fourth = transport.request(1, target, { ...request, requestId: "four" })
    await vi.waitFor(() => expect(pendingFetches).toHaveLength(4))
    transport.cancelAll()
    transport.cancelAll()
    await expect(fourth).rejects.toMatchObject({ code: "aborted" })
  })
})

describe("HttpTransport 强制结算", () => {
  it("fetch 忽略 abort 时仍按超时拒绝", async () => {
    vi.useFakeTimers()
    try {
      const transport = createTransport(vi.fn(() => new Promise<Response>(() => undefined)))
      const outcome = observePromise(
        transport.request(1, target, { ...request, requestId: "timeout-fetch", timeoutMs: 1_000 }),
      )

      await vi.advanceTimersByTimeAsync(1_000)
      await flushPromises()

      expect(outcome).toMatchObject({ error: { code: "timeout" }, status: "rejected" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("fetch 忽略 abort 时显式取消仍会拒绝", async () => {
    const transport = createTransport(vi.fn(() => new Promise<Response>(() => undefined)))
    const outcome = observePromise(
      transport.request(1, target, { ...request, requestId: "cancel-fetch" }),
    )

    transport.cancel("cancel-fetch", 1)
    await flushPromises()

    expect(outcome).toMatchObject({ error: { code: "aborted" }, status: "rejected" })
  })

  it("响应体读取忽略 abort 时仍按超时拒绝", async () => {
    vi.useFakeTimers()
    try {
      const body = new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => undefined),
      })
      const transport = createTransport(
        vi.fn().mockResolvedValue(
          new Response(body, {
            headers: { "content-type": "application/octet-stream" },
            status: 200,
          }),
        ),
      )
      const outcome = observePromise(
        transport.request(1, target, { ...request, requestId: "timeout-body", timeoutMs: 1_000 }),
      )

      await vi.advanceTimersByTimeAsync(1_000)
      await flushPromises()

      expect(outcome).toMatchObject({ error: { code: "timeout" }, status: "rejected" })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("HttpTransport 重定向边界", () => {
  it("允许同源 client API 重定向并由 Main 注入可信 Origin", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        responseWithUrl(
          { success: true },
          "https://chat.example.com/api/client/search/messages/?keyword=test",
        ),
      )
    const transport = createTransport(fetch)

    await expect(
      transport.request(1, target, {
        ...request,
        headers: { origin: "https://attacker.example" },
      }),
    ).resolves.toMatchObject({ status: 200 })
    expect(fetch).toHaveBeenCalledWith(
      "https://chat.example.com/api/client/me",
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.objectContaining({ Origin: "https://chat.example.com" }),
        redirect: "follow",
      }),
    )
  })

  it.each(["https://login.example.net/api/client/me", "https://chat.example.com/login"])(
    "拒绝越界重定向：%s",
    async (url) => {
      const transport = createTransport(vi.fn().mockResolvedValue(responseWithUrl({}, url)))

      await expect(transport.request(1, target, request)).rejects.toMatchObject({
        code: "invalid_request",
        message: "服务器重定向超出允许范围",
      })
    },
  )
})

describe("HttpTransport 认证目标隔离", () => {
  it("允许匿名目标读取公开的客户端信息", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    const transport = createTransport(fetch)

    await expect(
      transport.request(
        1,
        { ...target, userId: "anonymous" },
        {
          ...request,
          path: "/api/client/info",
        },
      ),
    ).resolves.toMatchObject({ status: 200 })
    expect(fetch).toHaveBeenCalledWith(
      "https://chat.example.com/api/client/info",
      expect.any(Object),
    )
  })

  it("拒绝匿名或旧用户访问非认证接口", async () => {
    const transport = createTransport(vi.fn().mockResolvedValue(jsonResponse({ success: true })))

    for (const [index, path] of ["/api/client/projects", "/api/client/info/private"].entries()) {
      await expect(
        transport.request(
          1,
          { ...target, userId: "anonymous" },
          {
            ...request,
            path,
            requestId: `invalid-${index}`,
          },
        ),
      ).rejects.toMatchObject({ code: "invalid_request", message: "认证目标已失效" })
    }
  })

  it("匿名目标只能访问精确登录和只读启动接口，不能修改或注销当前账号", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    const transport = createTransport(fetch)
    const protectedRequests = [
      { method: "PATCH", path: "/api/client/me" },
      { method: "POST", path: "/api/client/me/avatar" },
      { method: "POST", path: "/api/client/auth/logout" },
    ] as const

    for (const [index, protectedRequest] of protectedRequests.entries()) {
      await expect(
        transport.request(
          1,
          { ...target, userId: "anonymous" },
          {
            ...request,
            ...protectedRequest,
            requestId: `protected-${index}`,
          },
        ),
      ).rejects.toMatchObject({ code: "invalid_request", message: "认证目标已失效" })
    }
    expect(fetch).not.toHaveBeenCalled()

    await expect(
      transport.request(
        1,
        { ...target, userId: "anonymous" },
        {
          ...request,
          method: "POST",
          path: "/api/client/auth/login",
          requestId: "login",
        },
      ),
    ).resolves.toMatchObject({ status: 200 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("认证响应切换账号时通知文档窗口关闭旧 Server 资源", async () => {
    const profile = {
      id: target.id,
      lastUserId: target.userId,
      normalizedUrl: target.normalizedUrl,
    }
    const recordUser = vi.fn(async (_serverId: string, userId: string) => {
      profile.lastUserId = userId
    })
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { user: { id: "user-2" } } }))
    const profiles = { recordUser, require: vi.fn(() => profile) }
    const sessions = { for: vi.fn(() => ({ fetch })) }
    const onUserChanged = vi.fn()
    const transport = new HttpTransport(profiles as never, sessions as never, { onUserChanged })

    await expect(transport.request(7, target, request)).resolves.toMatchObject({ status: 200 })
    expect(recordUser).toHaveBeenCalledWith(target.id, "user-2")
    expect(onUserChanged).toHaveBeenCalledWith(target.id)
    await expect(
      transport.request(7, target, {
        ...request,
        requestId: "old-user",
        path: "/api/client/projects",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" })
  })

  it("认证持久化开始后取消请求，持久化成功仍触发账号资源清理", async () => {
    const persistence = deferred<void>()
    const profile = {
      id: target.id,
      lastUserId: target.userId,
      normalizedUrl: target.normalizedUrl,
    }
    const recordUser = vi.fn(async (_serverId: string, userId: string) => {
      await persistence.promise
      profile.lastUserId = userId
    })
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { user: { id: "user-2" } } }))
    const onUserChanged = vi.fn()
    const transport = new HttpTransport(
      { recordUser, require: vi.fn(() => profile) } as never,
      { for: vi.fn(() => ({ fetch })) } as never,
      { onUserChanged },
    )
    const pending = transport.request(7, target, {
      ...request,
      requestId: "cancel-during-record-user",
    })
    await vi.waitFor(() => expect(recordUser).toHaveBeenCalledOnce())

    transport.cancel("cancel-during-record-user", 7)
    await expect(pending).rejects.toMatchObject({ code: "aborted" })
    expect(onUserChanged).not.toHaveBeenCalled()

    persistence.resolve(undefined)
    await vi.waitFor(() => expect(onUserChanged).toHaveBeenCalledWith(target.id))
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  })
}

function responseWithUrl(body: unknown, url: string) {
  const response = jsonResponse(body)
  Object.defineProperty(response, "url", { configurable: true, value: url })
  return response
}

function createTransport(fetch: ReturnType<typeof vi.fn>) {
  const profiles = {
    recordUser: vi.fn(),
    require: vi.fn(() => ({ id: target.id, normalizedUrl: target.normalizedUrl })),
  }
  const sessions = { for: vi.fn(() => ({ fetch })) }
  return new HttpTransport(profiles as never, sessions as never)
}

function observePromise(promise: Promise<unknown>) {
  const outcome: { error?: unknown; status: "fulfilled" | "pending" | "rejected" } = {
    status: "pending",
  }
  void promise.then(
    () => {
      outcome.status = "fulfilled"
    },
    (error: unknown) => {
      outcome.error = error
      outcome.status = "rejected"
    },
  )
  return outcome
}

async function flushPromises() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}
