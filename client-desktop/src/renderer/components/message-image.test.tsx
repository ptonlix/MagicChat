import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MessageImage } from "@/components/message-image"
import { getImageThumbnailFrame } from "@/lib/image-message"
import { clampPreviewZoom } from "@/lib/message-image-preview"

const { readTemporaryFileURLsMock } = vi.hoisted(() => ({
  readTemporaryFileURLsMock: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()

  return {
    ...actual,
    readTemporaryFileURLs: readTemporaryFileURLsMock,
  }
})

describe("MessageImage", () => {
  beforeEach(() => {
    readTemporaryFileURLsMock.mockResolvedValue([
      {
        expiresAt: "2026-07-10T21:00:00Z",
        fileId: "file-1",
        url: "https://example.com/image.png",
      },
    ])
  })

  it("为有效尺寸计算稳定框架并让旧消息回退到 256x256", () => {
    expect(getImageThumbnailFrame({ height: 100, width: 400 })).toEqual({ height: 80, width: 320 })
    expect(getImageThumbnailFrame({ height: 800, width: 100 })).toEqual({ height: 360, width: 160 })
    expect(getImageThumbnailFrame({})).toEqual({
      height: 256,
      width: 256,
    })
    expect(getImageThumbnailFrame({ height: -1, width: 100 })).toEqual({ height: 256, width: 256 })
  })

  it("allows the native preview context menu without bubbling to message actions", async () => {
    const onContextMenu = vi.fn()

    render(
      <div onContextMenu={onContextMenu}>
        <MessageImage image={{ fileId: "file-1", type: "image" }} />
      </div>,
    )

    fireEvent.click(await screen.findByRole("button", { name: "预览图片" }))
    const previewImage = await screen.findByRole("img", {
      name: "图片消息预览",
    })

    const contextMenuAllowed = fireEvent.contextMenu(previewImage)

    expect(contextMenuAllowed).toBe(true)
    expect(onContextMenu).not.toHaveBeenCalled()
  })

  it("consumes the preview wheel gesture while zooming", async () => {
    render(<MessageImage image={{ fileId: "file-1", type: "image" }} />)

    fireEvent.click(await screen.findByRole("button", { name: "预览图片" }))
    const previewImage = await screen.findByRole("img", {
      name: "图片消息预览",
    })
    const previewArea = previewImage.parentElement as HTMLDivElement

    const wheelNotCanceled = fireEvent.wheel(previewArea, { deltaY: -1 })

    expect(wheelNotCanceled).toBe(false)
  })

  it("matches Web preview zoom bounds", () => {
    expect(clampPreviewZoom(0)).toBe(0.25)
    expect(clampPreviewZoom(8)).toBe(4)
    expect(clampPreviewZoom(1.234)).toBe(1.23)
  })
})
