import type { ScreenshotPoint, ScreenshotRect } from "@shared/screenshot-contract"

export const annotationColors = ["#ef4444", "#f59e0b", "#22c55e", "#2563eb", "#ffffff"] as const

type AnnotationBase = Readonly<{
  color: string
  id: string
  lineWidth: number
}>

export type RectangleAnnotation = AnnotationBase & ScreenshotRect & Readonly<{ kind: "rectangle" }>

export type MosaicAnnotation = AnnotationBase & ScreenshotRect & Readonly<{ kind: "mosaic" }>

export type ArrowAnnotation = AnnotationBase &
  Readonly<{
    end: ScreenshotPoint
    kind: "arrow"
    start: ScreenshotPoint
  }>

export type BrushAnnotation = AnnotationBase &
  Readonly<{
    kind: "brush"
    points: ReadonlyArray<number>
  }>

export type TextAnnotation = AnnotationBase &
  ScreenshotPoint &
  Readonly<{
    fontSize: number
    kind: "text"
    text: string
  }>

export type ScreenshotAnnotation =
  | ArrowAnnotation
  | BrushAnnotation
  | MosaicAnnotation
  | RectangleAnnotation
  | TextAnnotation

export type CaptureTool = "arrow" | "brush" | "mosaic" | "rectangle" | "select" | "text"

export type AnnotationHistory = Readonly<{
  future: ReadonlyArray<ReadonlyArray<ScreenshotAnnotation>>
  past: ReadonlyArray<ReadonlyArray<ScreenshotAnnotation>>
  present: ReadonlyArray<ScreenshotAnnotation>
}>

export const emptyAnnotationHistory: AnnotationHistory = {
  future: [],
  past: [],
  present: [],
}

export function commitAnnotation(
  history: AnnotationHistory,
  annotation: ScreenshotAnnotation,
): AnnotationHistory {
  return {
    future: [],
    past: [...history.past, history.present],
    present: [...history.present, annotation],
  }
}

export function undoAnnotationHistory(history: AnnotationHistory): AnnotationHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    future: [history.present, ...history.future],
    past: history.past.slice(0, -1),
    present: previous,
  }
}

export function redoAnnotationHistory(history: AnnotationHistory): AnnotationHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    future: history.future.slice(1),
    past: [...history.past, history.present],
    present: next,
  }
}

export function deleteAnnotation(
  history: AnnotationHistory,
  annotationId: string,
): AnnotationHistory {
  if (!history.present.some((annotation) => annotation.id === annotationId)) return history
  return {
    future: [],
    past: [...history.past, history.present],
    present: history.present.filter((annotation) => annotation.id !== annotationId),
  }
}
