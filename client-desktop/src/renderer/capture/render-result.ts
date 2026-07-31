import type { ScreenshotRect } from "@shared/screenshot-contract"
import type { ScreenshotAnnotation } from "./capture-types"

export async function renderCaptureResult(
  source: HTMLImageElement,
  selection: ScreenshotRect,
  annotations: ReadonlyArray<ScreenshotAnnotation>,
): Promise<Uint8Array> {
  const width = Math.max(1, Math.round(selection.width))
  const height = Math.max(1, Math.round(selection.height))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法创建截图画布")

  context.drawImage(
    source,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    0,
    0,
    width,
    height,
  )
  context.save()
  context.translate(-selection.x, -selection.y)
  context.beginPath()
  context.rect(selection.x, selection.y, selection.width, selection.height)
  context.clip()
  for (const annotation of annotations) drawAnnotation(context, source, annotation)
  context.restore()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("PNG 导出失败"))),
      "image/png",
    ),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

function drawAnnotation(
  context: CanvasRenderingContext2D,
  source: HTMLImageElement,
  annotation: ScreenshotAnnotation,
): void {
  context.save()
  context.lineCap = "round"
  context.lineJoin = "round"
  context.lineWidth = annotation.lineWidth
  context.strokeStyle = annotation.color
  context.fillStyle = annotation.color

  if (annotation.kind === "rectangle") {
    context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height)
  } else if (annotation.kind === "arrow") {
    drawArrow(context, annotation.start.x, annotation.start.y, annotation.end.x, annotation.end.y)
  } else if (annotation.kind === "brush") {
    context.beginPath()
    for (let index = 0; index < annotation.points.length; index += 2) {
      const x = annotation.points[index]
      const y = annotation.points[index + 1]
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.stroke()
  } else if (annotation.kind === "text") {
    context.font = `600 ${annotation.fontSize}px "HarmonyOS Sans SC", sans-serif`
    context.textBaseline = "top"
    context.fillText(annotation.text, annotation.x, annotation.y)
  } else {
    drawMosaic(context, source, annotation)
  }
  context.restore()
}

function drawArrow(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  const angle = Math.atan2(endY - startY, endX - startX)
  const headLength = Math.max(12, context.lineWidth * 4)
  const halfHeadWidth = Math.max(1, (context.lineWidth * 3) / 2)
  const baseX = endX - headLength * Math.cos(angle)
  const baseY = endY - headLength * Math.sin(angle)
  const offsetX = halfHeadWidth * Math.sin(angle)
  const offsetY = halfHeadWidth * Math.cos(angle)

  context.beginPath()
  context.moveTo(startX, startY)
  context.lineTo(endX, endY)
  context.stroke()

  context.beginPath()
  context.moveTo(endX, endY)
  context.lineTo(baseX - offsetX, baseY + offsetY)
  context.lineTo(baseX + offsetX, baseY - offsetY)
  context.closePath()
  context.fill()
  context.stroke()
}

function drawMosaic(
  context: CanvasRenderingContext2D,
  source: HTMLImageElement,
  annotation: Extract<ScreenshotAnnotation, { kind: "mosaic" }>,
): void {
  const width = Math.max(1, Math.round(annotation.width))
  const height = Math.max(1, Math.round(annotation.height))
  const pixelSize = Math.max(6, Math.round(Math.min(width, height) / 12))
  const sample = document.createElement("canvas")
  sample.width = Math.max(1, Math.ceil(width / pixelSize))
  sample.height = Math.max(1, Math.ceil(height / pixelSize))
  const sampleContext = sample.getContext("2d")
  if (!sampleContext) return
  sampleContext.drawImage(
    source,
    annotation.x,
    annotation.y,
    annotation.width,
    annotation.height,
    0,
    0,
    sample.width,
    sample.height,
  )
  context.imageSmoothingEnabled = false
  context.drawImage(sample, annotation.x, annotation.y, annotation.width, annotation.height)
  context.imageSmoothingEnabled = true
  context.lineWidth = Math.max(1, annotation.lineWidth / 2)
  context.strokeStyle = annotation.color
  context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height)
}
