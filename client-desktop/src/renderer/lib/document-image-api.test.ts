import { describe, expect, it, vi } from "vitest"
import {
  maximumDocumentImageBytes,
  resolveDocumentImageURLs,
  uploadDocumentImage,
} from "./document-image-api"

describe("文档图片 API", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"])(
    "上传合法 %s 图片",
    async (type) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(json({ success: true, data: { file: { id: "file-1", size_bytes: 1 } } }))
      await expect(
        uploadDocumentImage(new File(["x"], "image", { type }), fetcher),
      ).resolves.toEqual({ fileId: "file-1", sizeBytes: 1 })
      expect(fetcher).toHaveBeenCalledOnce()
    },
  )

  it("在请求前拒绝空文件、非法 MIME 和超过 10 MiB", async () => {
    const fetcher = vi.fn()
    await expect(
      uploadDocumentImage(new File([], "empty.png", { type: "image/png" }), fetcher),
    ).rejects.toThrow("为空")
    await expect(
      uploadDocumentImage(new File(["x"], "x.svg", { type: "image/svg+xml" }), fetcher),
    ).rejects.toThrow("PNG")
    const tooLarge = new File([new Uint8Array(maximumDocumentImageBytes + 1)], "large.png", {
      type: "image/png",
    })
    await expect(uploadDocumentImage(tooLarge, fetcher)).rejects.toThrow("10 MiB")
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("去重、按 100 个分批并保持结果顺序", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `file-${index}`)
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requested = JSON.parse(String(init?.body)).file_ids as string[]
      return json({
        success: true,
        data: {
          urls: [...requested].reverse().map((id) => ({
            expires_at: "2099-01-01T00:00:00Z",
            file_id: id,
            url: `https://example.com/${id}`,
          })),
        },
      })
    })
    const { urls } = await resolveDocumentImageURLs([...ids, ids[0]!], false, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(urls.map((item) => item.fileId)).toEqual(ids)
  })

  it("批量 404 时并发回退单文件解析并返回缺失文件", async () => {
    let activeRequests = 0
    let maximumActiveRequests = 0
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requested = JSON.parse(String(init?.body)).file_ids as string[]
      if (requested.length > 1)
        return json({ success: false, error: { message: "文件不存在" } }, 404)

      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
      await new Promise((resolve) => setTimeout(resolve, 0))
      activeRequests -= 1
      if (requested[0]?.endsWith("missing")) {
        return json({ success: false, error: { message: "文件不存在" } }, 404)
      }
      return json({
        success: true,
        data: {
          urls: [
            {
              expires_at: "2099-01-01T00:00:00Z",
              file_id: requested[0],
              url: `https://example.com/${requested[0]}`,
            },
          ],
        },
      })
    })

    await expect(
      resolveDocumentImageURLs(
        ["fallback-file-1", "fallback-file-missing", "fallback-file-3"],
        false,
        fetcher,
      ),
    ).resolves.toMatchObject({
      missingFileIds: ["fallback-file-missing"],
      urls: [{ fileId: "fallback-file-1" }, { fileId: "fallback-file-3" }],
    })
    expect(maximumActiveRequests).toBeGreaterThan(1)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
})

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}
