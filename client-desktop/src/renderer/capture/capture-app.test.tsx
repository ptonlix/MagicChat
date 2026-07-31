import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  getMetadata: vi.fn(),
  renderResult: vi.fn(),
  resultChunk: vi.fn(),
  resultFinish: vi.fn(),
  resultStart: vi.fn(),
}))

vi.mock("./render-result", () => ({ renderCaptureResult: mocks.renderResult }))
vi.mock("react-konva", async () => {
  const React = await import("react")
  const event = (x: number, y: number) => ({
    target: {
      getStage: () => ({ getPointerPosition: () => ({ x, y }) }),
      name: () => "",
    },
  })
  return {
    Arrow: () => null,
    Image: () => null,
    Layer: ({ children }: React.PropsWithChildren) => <>{children}</>,
    Line: () => null,
    Rect: () => null,
    Stage: ({ children, onMouseDown, onMouseMove, onMouseUp }: StageProps) => (
      <div>
        <button data-testid="stage-down" onClick={() => onMouseDown(event(10, 10))} />
        <button data-testid="stage-edge-down" onClick={() => onMouseDown(event(75, 65))} />
        <button data-testid="stage-move" onClick={() => onMouseMove(event(80, 70))} />
        <button data-testid="stage-up" onClick={onMouseUp} />
        {children}
      </div>
    ),
    Text: () => null,
  }
})

import { CaptureApp } from "./capture-app"

describe("CaptureApp 键盘工作流", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 })
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 100 })
    Object.defineProperty(window, "capture", {
      configurable: true,
      value: {
        cancel: mocks.cancel,
        getMetadata: mocks.getMetadata,
        resultChunk: mocks.resultChunk,
        resultFinish: mocks.resultFinish,
        resultStart: mocks.resultStart,
      },
    })
    mocks.getMetadata.mockResolvedValue({
      defaultOutput: "conversation",
      display: {
        bounds: { height: 100, width: 100, x: 0, y: 0 },
        id: "7",
        imageHeight: 100,
        imageWidth: 100,
        scaleFactor: 1,
      },
      sessionId: "session-1",
      sourceUrl: "magicchat-capture://source/session/token",
    })
    mocks.renderResult.mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    mocks.resultFinish.mockResolvedValue({ status: "completed" })
    vi.stubGlobal(
      "Image",
      class ImageMock {
        crossOrigin = ""
        decoding = ""
        onerror: (() => void) | null = null
        onload: (() => void) | null = null

        set src(_value: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    )
  })

  it("创建选区后按 Enter 提交当前默认输出", async () => {
    render(<CaptureApp />)
    await screen.findByRole("toolbar", { name: "截图工具栏" })

    fireEvent.click(screen.getByTestId("stage-down"))
    fireEvent.click(screen.getByTestId("stage-move"))
    fireEvent.click(screen.getByTestId("stage-up"))
    await screen.findByText("70 x 60")
    fireEvent.keyDown(window, { key: "Enter" })

    await waitFor(() =>
      expect(mocks.resultStart).toHaveBeenCalledWith({
        action: "conversation",
        totalBytes: 8,
        totalChunks: 1,
      }),
    )
    expect(mocks.resultChunk).toHaveBeenCalledWith(0, expect.any(Uint8Array))
    expect(mocks.resultFinish).toHaveBeenCalledOnce()
  })

  it("按 Escape 取消整个截图会话", async () => {
    render(<CaptureApp />)
    await screen.findByRole("toolbar", { name: "截图工具栏" })

    fireEvent.keyDown(window, { key: "Escape" })

    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it("在 rAF 延迟到松手之后仍提交最新标注", async () => {
    render(<CaptureApp />)
    await screen.findByRole("toolbar", { name: "截图工具栏" })
    fireEvent.click(screen.getByTestId("stage-down"))
    fireEvent.click(screen.getByTestId("stage-move"))
    fireEvent.click(screen.getByTestId("stage-up"))
    await screen.findByText("70 x 60")

    fireEvent.click(screen.getByRole("button", { name: "矩形" }))
    let pendingFrame: FrameRequestCallback | undefined
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        pendingFrame = callback
        return 99
      })
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame")

    try {
      fireEvent.click(screen.getByTestId("stage-down"))
      fireEvent.click(screen.getByTestId("stage-move"))
      fireEvent.click(screen.getByTestId("stage-up"))

      expect(cancelFrame).toHaveBeenCalledWith(99)
      expect(pendingFrame).toBeDefined()
      expect(screen.getByRole("button", { name: "撤销" })).not.toBeDisabled()
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  it("使用文本工具在截图内录入并提交文字", async () => {
    render(<CaptureApp />)
    await screen.findByRole("toolbar", { name: "截图工具栏" })
    fireEvent.click(screen.getByTestId("stage-down"))
    fireEvent.click(screen.getByTestId("stage-move"))
    fireEvent.click(screen.getByTestId("stage-up"))
    await screen.findByText("70 x 60")

    fireEvent.click(screen.getByRole("button", { name: "文本" }))
    fireEvent.click(screen.getByTestId("stage-down"))
    expect(screen.queryByRole("textbox", { name: "文本标注" })).toBeNull()
    fireEvent.click(screen.getByTestId("stage-up"))
    const editor = await screen.findByRole("textbox", { name: "文本标注" })
    fireEvent.change(editor, { target: { value: "测试文字" } })
    fireEvent.keyDown(editor, { key: "Enter" })

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "文本标注" })).toBeNull())
    expect(screen.getByRole("button", { name: "撤销" })).not.toBeDisabled()
  })

  it("中文输入法组词时按 Enter 不会提前提交文本", async () => {
    render(<CaptureApp />)
    await screen.findByRole("toolbar", { name: "截图工具栏" })
    fireEvent.click(screen.getByTestId("stage-down"))
    fireEvent.click(screen.getByTestId("stage-move"))
    fireEvent.click(screen.getByTestId("stage-up"))
    await screen.findByText("70 x 60")

    fireEvent.click(screen.getByRole("button", { name: "文本" }))
    fireEvent.click(screen.getByTestId("stage-down"))
    fireEvent.click(screen.getByTestId("stage-up"))
    const editor = await screen.findByRole("textbox", { name: "文本标注" })
    fireEvent.change(editor, { target: { value: "测试" } })
    fireEvent.keyDown(editor, { isComposing: true, key: "Enter" })

    expect(screen.getByRole("textbox", { name: "文本标注" })).toHaveValue("测试")
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled()

    fireEvent.keyDown(editor, { key: "Enter" })
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "文本标注" })).toBeNull())
    expect(screen.getByRole("button", { name: "撤销" })).not.toBeDisabled()
  })

  it("将靠近右下角的文本标注坐标与输入框位置保持一致", async () => {
    render(<CaptureApp />)
    await screen.findByRole("toolbar", { name: "截图工具栏" })
    fireEvent.click(screen.getByTestId("stage-down"))
    fireEvent.click(screen.getByTestId("stage-move"))
    fireEvent.click(screen.getByTestId("stage-up"))
    await screen.findByText("70 x 60")

    fireEvent.click(screen.getByRole("button", { name: "文本" }))
    fireEvent.click(screen.getByTestId("stage-edge-down"))
    fireEvent.click(screen.getByTestId("stage-up"))
    const editor = await screen.findByRole("textbox", { name: "文本标注" })
    fireEvent.change(editor, { target: { value: "边缘文字" } })
    fireEvent.keyDown(editor, { key: "Enter" })
    fireEvent.click(screen.getByRole("button", { name: "确认当前操作" }))

    await waitFor(() => expect(mocks.renderResult).toHaveBeenCalledOnce())
    expect(mocks.renderResult.mock.calls[0][2]).toEqual([
      expect.objectContaining({ x: 16, y: 56, text: "边缘文字" }),
    ])
  })
})

type StageEvent = {
  target: {
    getStage: () => { getPointerPosition: () => { x: number; y: number } }
    name: () => string
  }
}

type StageProps = React.PropsWithChildren<{
  onMouseDown: (event: StageEvent) => void
  onMouseMove: (event: StageEvent) => void
  onMouseUp: () => void
}>
