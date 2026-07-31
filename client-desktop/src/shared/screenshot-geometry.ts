import type { ScreenshotPoint, ScreenshotRect } from "@shared/screenshot-contract"

export type ResizeHandle = "e" | "n" | "ne" | "nw" | "s" | "se" | "sw" | "w"

export function createSelection(start: ScreenshotPoint, end: ScreenshotPoint): ScreenshotRect {
  return {
    height: Math.abs(end.y - start.y),
    width: Math.abs(end.x - start.x),
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
  }
}

export function clampSelection(
  selection: ScreenshotRect,
  imageWidth: number,
  imageHeight: number,
  minimumSize = 1,
): ScreenshotRect {
  const maxWidth = positive(imageWidth)
  const maxHeight = positive(imageHeight)
  const width = clamp(selection.width, Math.min(minimumSize, maxWidth), maxWidth)
  const height = clamp(selection.height, Math.min(minimumSize, maxHeight), maxHeight)
  return {
    height,
    width,
    x: clamp(selection.x, 0, maxWidth - width),
    y: clamp(selection.y, 0, maxHeight - height),
  }
}

export function moveSelection(
  selection: ScreenshotRect,
  delta: ScreenshotPoint,
  imageWidth: number,
  imageHeight: number,
): ScreenshotRect {
  return clampSelection(
    { ...selection, x: selection.x + delta.x, y: selection.y + delta.y },
    imageWidth,
    imageHeight,
  )
}

export function resizeSelection(
  selection: ScreenshotRect,
  handle: ResizeHandle,
  delta: ScreenshotPoint,
  imageWidth: number,
  imageHeight: number,
  minimumSize = 8,
): ScreenshotRect {
  let left = selection.x
  let top = selection.y
  let right = selection.x + selection.width
  let bottom = selection.y + selection.height

  if (handle.includes("w")) left = Math.min(left + delta.x, right - minimumSize)
  if (handle.includes("e")) right = Math.max(right + delta.x, left + minimumSize)
  if (handle.includes("n")) top = Math.min(top + delta.y, bottom - minimumSize)
  if (handle.includes("s")) bottom = Math.max(bottom + delta.y, top + minimumSize)

  left = clamp(left, 0, imageWidth)
  right = clamp(right, 0, imageWidth)
  top = clamp(top, 0, imageHeight)
  bottom = clamp(bottom, 0, imageHeight)

  if (right - left < minimumSize) {
    if (handle.includes("w")) left = Math.max(0, right - minimumSize)
    else right = Math.min(imageWidth, left + minimumSize)
  }
  if (bottom - top < minimumSize) {
    if (handle.includes("n")) top = Math.max(0, bottom - minimumSize)
    else bottom = Math.min(imageHeight, top + minimumSize)
  }

  return { height: bottom - top, width: right - left, x: left, y: top }
}

export function cssPointToImage(
  point: ScreenshotPoint,
  overlayWidth: number,
  overlayHeight: number,
  imageWidth: number,
  imageHeight: number,
): ScreenshotPoint {
  if (overlayWidth <= 0 || overlayHeight <= 0) return { x: 0, y: 0 }
  return {
    x: clamp((point.x / overlayWidth) * imageWidth, 0, imageWidth),
    y: clamp((point.y / overlayHeight) * imageHeight, 0, imageHeight),
  }
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum)
}
