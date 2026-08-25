import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it("点击未缩放预览的图片外留白或关闭按钮会关闭预览", async () => {
    render(<MessageImage image={{ fileId: "file-1", type: "image" }} />)

    const previewTrigger = await screen.findByRole("button", { name: "预览图片" })
    fireEvent.click(previewTrigger)
    const previewImage = await screen.findByRole("img", { name: "图片消息预览" })
    const previewArea = previewImage.parentElement
    if (!(previewArea instanceof HTMLDivElement)) throw new Error("预览区域尚未渲染")

    fireEvent.click(previewArea)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    fireEvent.click(previewTrigger)
    await screen.findByRole("dialog", { name: "图片预览" })
    fireEvent.click(screen.getByRole("button", { name: "关闭图片预览" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("预览加载后缩小图片，并将缩放限制在上限", async () => {
    const { previewArea, previewImage, restorePreviewAreaSize } = await openLoadedPreview()
    try {
      expect(previewImage).toHaveStyle({ height: "100px", width: "200px" })

      const wheelNotCanceled = fireEvent.wheel(previewArea, { deltaY: 1 })
      expect(wheelNotCanceled).toBe(false)
      await waitFor(() => expect(previewImage).toHaveStyle({ height: "90px", width: "180px" }))

      for (let index = 0; index < 40; index += 1) {
        fireEvent.wheel(previewArea, { deltaY: -1 })
      }
      await waitFor(() => expect(previewImage).toHaveStyle({ height: "400px", width: "800px" }))
    } finally {
      restorePreviewAreaSize()
    }
  })

  it.each([
    ["右侧", 999, 0, "translate(-50%, -50%) translate(300px, 0px)"],
    ["左侧", -999, 0, "translate(-50%, -50%) translate(-300px, 0px)"],
    ["下侧", 0, 999, "translate(-50%, -50%) translate(0px, 150px)"],
    ["上侧", 0, -999, "translate(-50%, -50%) translate(0px, -150px)"],
  ])("拖拽预览到%s边界时钳制偏移", async (_edge, clientX, clientY, transform) => {
    const { previewArea, previewImage, restorePreviewAreaSize } = await openLoadedPreview()
    try {
      for (let index = 0; index < 30; index += 1) {
        fireEvent.wheel(previewArea, { deltaY: -1 })
      }
      await waitFor(() => expect(previewImage).toHaveStyle({ height: "400px", width: "800px" }))

      fireEvent.pointerDown(previewArea, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
      fireEvent.pointerMove(previewArea, { clientX, clientY, pointerId: 1 })
      fireEvent.pointerUp(previewArea, { clientX, clientY, pointerId: 1 })

      await waitFor(() => expect(previewImage).toHaveStyle({ transform }))
    } finally {
      restorePreviewAreaSize()
    }
  })

  it("matches Web preview zoom bounds", () => {
    expect(clampPreviewZoom(0)).toBe(0.25)
    expect(clampPreviewZoom(8)).toBe(4)
    expect(clampPreviewZoom(1.234)).toBe(1.23)
  })
})

async function openLoadedPreview() {
  const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100)
  const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200)
  render(<MessageImage image={{ fileId: "file-1", type: "image" }} />)

  fireEvent.click(await screen.findByRole("button", { name: "预览图片" }))
  const previewImage = await screen.findByRole<HTMLImageElement>("img", { name: "图片消息预览" })
  const previewArea = previewImage.parentElement
  if (!(previewArea instanceof HTMLDivElement)) throw new Error("预览区域尚未渲染")

  Object.defineProperties(previewImage, {
    naturalHeight: { configurable: true, value: 200 },
    naturalWidth: { configurable: true, value: 400 },
  })
  fireEvent.load(previewImage)
  await waitFor(() => expect(previewImage).toHaveStyle({ height: "100px", width: "200px" }))

  return {
    previewArea,
    previewImage,
    restorePreviewAreaSize: () => {
      clientHeight.mockRestore()
      clientWidth.mockRestore()
    },
  }
}
