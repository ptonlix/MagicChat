import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { StreamingUploadController } from "@main/streaming-upload"

const profile = { id: "server-1", normalizedUrl: "https://chat.test" }
const target = { ...profile, userId: "user-1" }

describe("流式上传", () => {
  it("使用有界分块传入网络流而不是单个大 IPC 内容", async () => {
    let received = ""
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = Readable.fromWeb(init.body as import("node:stream/web").ReadableStream)
      for await (const chunk of body) received += Buffer.from(chunk).toString()
      return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" }, status: 200 })
    })
    const controller = new StreamingUploadController(
      { require: () => profile } as never,
      { for: () => ({ fetch }) } as never
    )
    const streamId = controller.start(7, target, {
      headers: { "content-type": "multipart/form-data; boundary=test" },
      method: "POST",
      path: "/api/client/temporary-files",
      requestId: "request_1",
    })
    await controller.chunk(7, streamId, new TextEncoder().encode("first-"))
    await controller.chunk(7, streamId, new TextEncoder().encode("second"))
    const response = await controller.finish(7, streamId)
    expect(response.status).toBe(200)
    expect(received).toBe("first-second")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("拒绝超过 256 KiB 的单个 IPC 分块", async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    }))
    const controller = new StreamingUploadController(
      { require: () => profile } as never,
      { for: () => ({ fetch }) } as never
    )
    const streamId = controller.start(8, target, {
      headers: { "content-type": "multipart/form-data; boundary=test" }, method: "POST",
      path: "/api/client/temporary-files", requestId: "request_2",
    })
    await expect(controller.chunk(8, streamId, new Uint8Array(256 * 1024 + 1))).rejects.toThrow("分块")
    controller.abort(8, streamId)
  })

  it("移除服务器时只中止该服务器的活动上传", async () => {
    const aborted: string[] = []
    const fetch = vi.fn((url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted.push(url)
        reject(new DOMException("aborted", "AbortError"))
      })
    }))
    const otherProfile = { id: "server-2", normalizedUrl: "https://other.test" }
    const controller = new StreamingUploadController(
      { require: (id: string) => id === profile.id ? profile : otherProfile } as never,
      { for: () => ({ fetch }) } as never
    )
    controller.start(9, target, {
      headers: { "content-type": "multipart/form-data; boundary=first" }, method: "POST",
      path: "/api/client/temporary-files", requestId: "request_3",
    })
    const otherStream = controller.start(9, { ...otherProfile, userId: "user-2" }, {
      headers: { "content-type": "multipart/form-data; boundary=second" }, method: "POST",
      path: "/api/client/temporary-files", requestId: "request_4",
    })

    controller.cleanupServer(profile.id)
    expect(aborted).toEqual(["https://chat.test/api/client/temporary-files"])
    expect(controller.hasActiveTransfers()).toBe(true)
    controller.abort(9, otherStream)
  })
})
