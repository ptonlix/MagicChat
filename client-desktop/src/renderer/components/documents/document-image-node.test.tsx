import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
}))

vi.mock("@/lib/document-image-api", () => ({
  uploadDocumentImage: mocks.upload,
}))

import { DocumentImageNodeView } from "./document-image-node"
import { DocumentImageResolutionContext } from "./document-image-resolution"
import { configureDesktopHost } from "@/lib/desktop-host"

describe("DocumentImageNodeView", () => {
  it("StrictMode 下上传完成后仍会写入图片 fileId", async () => {
    mocks.upload.mockResolvedValue({ fileId: "file-1", sizeBytes: 1 })
    const updateAttributes = vi.fn()
    const file = new File(["image"], "photo.png", { type: "image/png" })
    const props = {
      node: {
        attrs: { alignment: "center", alt: "", externalUrl: null, fileId: null, width: 100 },
      } as unknown as NodeViewProps["node"],
      updateAttributes,
    } as unknown as NodeViewProps

    render(
      <StrictMode>
        <DocumentImageNodeView {...props} />
      </StrictMode>,
    )

    fireEvent.change(screen.getByLabelText("上传图片文件"), { target: { files: [file] } })
    await waitFor(() =>
      expect(updateAttributes).toHaveBeenCalledWith({
        alt: "photo.png",
        externalUrl: null,
        fileId: "file-1",
      }),
    )
  })

  it("区分加载状态并拒绝加载 HTTP 外部图片", () => {
    const refresh = vi.fn()
    const loadingNode = {
      attrs: { alignment: "center", alt: "", externalUrl: null, fileId: "file-1", width: 100 },
    } as unknown as NodeViewProps["node"]
    const httpNode = {
      attrs: {
        alignment: "center",
        alt: "",
        externalUrl: "http://example.com/image.png",
        fileId: null,
        width: 100,
      },
    } as unknown as NodeViewProps["node"]

    const { container, rerender } = render(
      <DocumentImageResolutionContext.Provider
        value={{ refresh, resolutions: new Map([["file-1", { status: "loading" as const }]]) }}
      >
        <DocumentImageNodeView
          {...({ node: loadingNode, updateAttributes: vi.fn() } as unknown as NodeViewProps)}
        />
      </DocumentImageResolutionContext.Provider>,
    )
    expect(screen.getByText("正在加载图片")).toBeVisible()
    expect(container.querySelector(".document-image-node__placeholder-icon")).not.toBeNull()

    rerender(
      <DocumentImageResolutionContext.Provider value={{ refresh, resolutions: new Map() }}>
        <DocumentImageNodeView
          {...({ node: httpNode, updateAttributes: vi.fn() } as unknown as NodeViewProps)}
        />
      </DocumentImageResolutionContext.Provider>,
    )
    expect(screen.getByText("Desktop 不加载 HTTP 图片")).toBeVisible()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("通过 Desktop Host adapter 解析受保护的同源图片 URL", () => {
    const resolveResourceUrl = vi.fn((url: string) => `magicchat-media://asset${url}`)
    const restoreHost = configureDesktopHost({ resolveResourceUrl })
    try {
      const node = {
        attrs: {
          alignment: "center",
          alt: "受保护图片",
          externalUrl: null,
          fileId: "file-1",
          width: 100,
        },
      } as unknown as NodeViewProps["node"]

      render(
        <DocumentImageResolutionContext.Provider
          value={{
            refresh: vi.fn(),
            resolutions: new Map([
              [
                "file-1",
                {
                  expiresAt: "2099-01-01T00:00:00.000Z",
                  status: "ready" as const,
                  url: "/api/client/temporary-files/file-1",
                },
              ],
            ]),
          }}
        >
          <DocumentImageNodeView
            {...({ node, updateAttributes: vi.fn() } as unknown as NodeViewProps)}
          />
        </DocumentImageResolutionContext.Provider>,
      )

      expect(resolveResourceUrl).toHaveBeenCalledWith("/api/client/temporary-files/file-1")
      expect(screen.getByRole("img", { name: "受保护图片" })).toHaveAttribute(
        "src",
        "magicchat-media://asset/api/client/temporary-files/file-1",
      )
    } finally {
      restoreHost()
    }
  })

  it.each(["Enter", " "])("支持 %s 键打开图片设置控件", (key) => {
    const node = {
      attrs: {
        alignment: "center",
        alt: "可访问图片",
        externalUrl: "https://example.com/image.png",
        fileId: null,
        width: 100,
      },
    } as unknown as NodeViewProps["node"]

    render(
      <DocumentImageNodeView
        {...({ node, updateAttributes: vi.fn() } as unknown as NodeViewProps)}
      />,
    )

    fireEvent.keyDown(screen.getByRole("button", { name: "设置图片" }), { key })
    expect(screen.getByLabelText("图片替代文本")).toBeVisible()
  })

  it("只读状态禁用图片上传和属性编辑入口", () => {
    const updateAttributes = vi.fn()
    const node = {
      attrs: {
        alignment: "center",
        alt: "只读图片",
        externalUrl: "https://example.com/image.png",
        fileId: null,
        width: 100,
      },
    } as unknown as NodeViewProps["node"]

    render(
      <DocumentImageResolutionContext.Provider value={{ refresh: vi.fn(), resolutions: new Map() }}>
        <DocumentImageNodeView
          {...({
            editor: { isEditable: false },
            node,
            updateAttributes,
          } as unknown as NodeViewProps)}
        />
      </DocumentImageResolutionContext.Provider>,
    )

    const trigger = screen.getByRole("button", { name: "设置图片" })
    expect(trigger).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByLabelText("上传图片文件")).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByLabelText("图片替代文本")).toBeNull()
    expect(updateAttributes).not.toHaveBeenCalled()
  })
})
