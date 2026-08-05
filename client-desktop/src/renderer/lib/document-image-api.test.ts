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
})

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}
