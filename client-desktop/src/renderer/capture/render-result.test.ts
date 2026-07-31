import { afterEach, describe, expect, it, vi } from "vitest"
import type { ScreenshotAnnotation } from "./capture-types"
import { renderCaptureResult } from "./render-result"

function createContext() {
  return {
    beginPath: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
  }
}

function mockCanvasContexts(...contexts: Array<ReturnType<typeof createContext>>) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => contexts.shift() as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
    callback(new Blob([new Uint8Array([1])])),
  )
}

describe("截图结果渲染", () => {
  afterEach(() => vi.restoreAllMocks())

  it("导出箭头时绘制填充箭头头部", async () => {
    const context = createContext()
    mockCanvasContexts(context)
    const annotation: ScreenshotAnnotation = {
      color: "#ef4444",
      end: { x: 80, y: 70 },
      id: "arrow-1",
      kind: "arrow",
      lineWidth: 3,
      start: { x: 20, y: 20 },
    }

    await renderCaptureResult(new Image(), { height: 60, width: 70, x: 10, y: 10 }, [annotation])

    expect(context.fill).toHaveBeenCalledOnce()
  })

  it("导出马赛克时保留标注边框", async () => {
    const outputContext = createContext()
    const sampleContext = createContext()
    mockCanvasContexts(outputContext, sampleContext)
    const annotation: ScreenshotAnnotation = {
      color: "#ef4444",
      height: 30,
      id: "mosaic-1",
      kind: "mosaic",
      lineWidth: 3,
      width: 30,
      x: 20,
      y: 20,
    }

    await renderCaptureResult(new Image(), { height: 60, width: 70, x: 10, y: 10 }, [annotation])

    expect(outputContext.strokeRect).toHaveBeenCalledWith(20, 20, 30, 30)
  })
})
