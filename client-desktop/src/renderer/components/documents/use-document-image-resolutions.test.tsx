import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }))

vi.mock("@/lib/document-image-api", () => ({
  resolveDocumentImageURLs: mocks.resolve,
}))

import { DocumentImage } from "./document-image-extension"
import { useDocumentImageResolutions } from "./use-document-image-resolutions"

describe("useDocumentImageResolutions", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it("解析活动图片、移除已删除节点并在卸载时解除监听", async () => {
    mocks.resolve.mockResolvedValue({
      missingFileIds: [],
      urls: [
        {
          expiresAt: "2099-01-01T00:00:00.000Z",
          fileId: "file-1",
          url: "https://example.com/file-1",
        },
      ],
    })
    const editor = createEditor()
    const off = vi.spyOn(editor, "off")
    const hook = renderHook(() => useDocumentImageResolutions(editor))

    await waitFor(() => expect(hook.result.current.resolutions.get("file-1")?.status).toBe("ready"))
    act(() => editor.commands.clearContent())
    await waitFor(() => expect(hook.result.current.resolutions.has("file-1")).toBe(false))
    hook.unmount()
    expect(off).toHaveBeenCalledWith("transaction", expect.any(Function))
    editor.destroy()
  })

  it("在到期前刷新并在自动重试耗尽后允许手动恢复", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"))
    mocks.resolve
      .mockResolvedValueOnce({
        missingFileIds: [],
        urls: [
          {
            expiresAt: "2026-08-05T00:04:00.000Z",
            fileId: "file-1",
            url: "https://example.com/first",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("暂时失败"))
      .mockRejectedValueOnce(new Error("暂时失败"))
      .mockRejectedValueOnce(new Error("暂时失败"))
      .mockRejectedValueOnce(new Error("暂时失败"))
      .mockResolvedValueOnce({
        missingFileIds: [],
        urls: [
          {
            expiresAt: "2099-01-01T00:00:00.000Z",
            fileId: "file-1",
            url: "https://example.com/recovered",
          },
        ],
      })
    const editor = createEditor()
    const hook = renderHook(() => useDocumentImageResolutions(editor))
    await act(async () => Promise.resolve())
    expect(hook.result.current.resolutions.get("file-1")?.status).toBe("ready")

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    await act(async () => vi.advanceTimersByTimeAsync(2_000))
    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    expect(hook.result.current.resolutions.get("file-1")?.status).toBe("failed")

    await act(async () => {
      hook.result.current.refresh("file-1")
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(hook.result.current.resolutions.get("file-1")).toMatchObject({
      status: "ready",
      url: "https://example.com/recovered",
    })
    hook.unmount()
    editor.destroy()
  })

  it("重新签名仍不足五分钟时停止自动刷新，避免图片每秒重新加载", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"))
    mocks.resolve.mockResolvedValue({
      missingFileIds: [],
      urls: [
        {
          expiresAt: "2026-08-05T00:04:00.000Z",
          fileId: "file-1",
          url: "https://example.com/short-lived",
        },
      ],
    })
    const editor = createEditor()
    const hook = renderHook(() => useDocumentImageResolutions(editor))
    await act(async () => Promise.resolve())

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.resolve).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    expect(mocks.resolve).toHaveBeenCalledTimes(2)
    expect(hook.result.current.resolutions.get("file-1")).toMatchObject({
      status: "ready",
      url: "https://example.com/short-lived",
    })

    act(() => hook.result.current.refresh("file-1"))
    await act(async () => Promise.resolve())
    expect(mocks.resolve).toHaveBeenCalledTimes(3)
    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    expect(mocks.resolve).toHaveBeenCalledTimes(3)
    hook.unmount()
    editor.destroy()
  })

  it("卸载后丢弃仍在等待的解析结果", async () => {
    let finish: ((value: unknown) => void) | undefined
    mocks.resolve.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const editor = createEditor()
    const hook = renderHook(() => useDocumentImageResolutions(editor))
    hook.unmount()
    await act(async () => {
      finish?.({
        missingFileIds: [],
        urls: [
          {
            expiresAt: "2099-01-01T00:00:00.000Z",
            fileId: "file-1",
            url: "https://example.com/stale",
          },
        ],
      })
      await Promise.resolve()
    })
    editor.destroy()
  })

  it("图片节点删除后丢弃仍在等待的解析结果且不创建重试", async () => {
    let finish: ((value: unknown) => void) | undefined
    mocks.resolve.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const editor = createEditor()
    const hook = renderHook(() => useDocumentImageResolutions(editor))
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))

    act(() => editor.commands.clearContent())
    await waitFor(() => expect(hook.result.current.resolutions.has("file-1")).toBe(false))

    await act(async () => {
      finish?.({
        missingFileIds: [],
        urls: [
          {
            expiresAt: "2099-01-01T00:00:00.000Z",
            fileId: "file-1",
            url: "https://example.com/stale",
          },
        ],
      })
      await Promise.resolve()
    })

    expect(hook.result.current.resolutions.has("file-1")).toBe(false)
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
    hook.unmount()
    editor.destroy()
  })

  it("切换文档后丢弃旧文档的解析结果", async () => {
    let finishOld: ((value: unknown) => void) | undefined
    mocks.resolve
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve
        }),
      )
      .mockResolvedValueOnce({
        missingFileIds: [],
        urls: [
          {
            expiresAt: "2099-01-01T00:00:00.000Z",
            fileId: "file-2",
            url: "https://example.com/file-2",
          },
        ],
      })
    const firstEditor = createEditor("file-1")
    const secondEditor = createEditor("file-2")
    const hook = renderHook(({ editor }) => useDocumentImageResolutions(editor), {
      initialProps: { editor: firstEditor },
    })
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))

    hook.rerender({ editor: secondEditor })
    await waitFor(() => expect(hook.result.current.resolutions.get("file-2")?.status).toBe("ready"))

    await act(async () => {
      finishOld?.({
        missingFileIds: [],
        urls: [
          {
            expiresAt: "2099-01-01T00:00:00.000Z",
            fileId: "file-1",
            url: "https://example.com/stale",
          },
        ],
      })
      await Promise.resolve()
    })

    expect(hook.result.current.resolutions.has("file-1")).toBe(false)
    expect(hook.result.current.resolutions.get("file-2")?.status).toBe("ready")
    hook.unmount()
    firstEditor.destroy()
    secondEditor.destroy()
  })
})

function createEditor(fileId = "file-1") {
  return new Editor({
    content: `<figure data-document-image data-file-id="${fileId}"><span>文档图片</span></figure>`,
    extensions: [StarterKit, DocumentImage],
  })
}
