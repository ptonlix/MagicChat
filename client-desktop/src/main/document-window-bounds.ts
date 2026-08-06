import { DOCUMENT_WINDOW_LIMITS } from "@shared/document-window-contract"

export type DocumentWindowRectangle = Readonly<{
  height: number
  width: number
  x: number
  y: number
}>

export type DocumentWindowWorkArea = DocumentWindowRectangle

export function defaultDocumentWindowBounds(
  workArea: DocumentWindowWorkArea,
  mainBounds?: DocumentWindowRectangle,
): DocumentWindowRectangle {
  const width = Math.max(
    DOCUMENT_WINDOW_LIMITS.minWidth,
    Math.min(
      DOCUMENT_WINDOW_LIMITS.defaultWidth,
      Math.max(workArea.width, DOCUMENT_WINDOW_LIMITS.minWidth),
    ),
  )
  const height = Math.max(
    DOCUMENT_WINDOW_LIMITS.minHeight,
    Math.min(
      DOCUMENT_WINDOW_LIMITS.defaultHeight,
      Math.max(workArea.height, DOCUMENT_WINDOW_LIMITS.minHeight),
    ),
  )
  const preferredX = mainBounds ? mainBounds.x + mainBounds.width + 16 : workArea.x + 32
  const preferredY = mainBounds?.y ?? workArea.y + 32
  return clampDocumentWindowBounds({ height, width, x: preferredX, y: preferredY }, workArea)
}

export function clampDocumentWindowBounds(
  bounds: DocumentWindowRectangle,
  workArea: DocumentWindowWorkArea,
): DocumentWindowRectangle {
  const width = Math.max(DOCUMENT_WINDOW_LIMITS.minWidth, Math.trunc(bounds.width))
  const height = Math.max(DOCUMENT_WINDOW_LIMITS.minHeight, Math.trunc(bounds.height))
  const maxX = workArea.x + Math.max(0, workArea.width - width)
  const maxY = workArea.y + Math.max(0, workArea.height - height)
  return Object.freeze({
    height,
    width,
    x: clamp(Math.trunc(bounds.x), workArea.x, maxX),
    y: clamp(Math.trunc(bounds.y), workArea.y, maxY),
  })
}

export function resolveDocumentWindowBounds(
  saved: DocumentWindowRectangle | undefined,
  workArea: DocumentWindowWorkArea,
  mainBounds?: DocumentWindowRectangle,
): DocumentWindowRectangle {
  if (!isValidDocumentWindowRectangle(saved))
    return defaultDocumentWindowBounds(workArea, mainBounds)
  if (isCompletelyOutside(saved, workArea)) return defaultDocumentWindowBounds(workArea, mainBounds)
  return clampDocumentWindowBounds(saved, workArea)
}

export function isValidDocumentWindowRectangle(value: unknown): value is DocumentWindowRectangle {
  if (!value || typeof value !== "object") return false
  const input = value as Record<string, unknown>
  const { height, width, x, y } = input
  return (
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
  )
}

function isCompletelyOutside(
  bounds: DocumentWindowRectangle,
  workArea: DocumentWindowWorkArea,
): boolean {
  return (
    bounds.x + bounds.width <= workArea.x ||
    bounds.y + bounds.height <= workArea.y ||
    bounds.x >= workArea.x + workArea.width ||
    bounds.y >= workArea.y + workArea.height
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
