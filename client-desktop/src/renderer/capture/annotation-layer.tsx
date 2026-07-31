import * as React from "react"
import Konva from "konva"
import { Arrow, Image as KonvaImage, Line, Rect, Text } from "react-konva"
import type { KonvaEventObject } from "konva/lib/Node"
import type { MosaicAnnotation, ScreenshotAnnotation } from "./capture-types"

export function AnnotationLayer({
  annotations,
  draft,
  selectedId,
  onSelect,
  source,
}: {
  annotations: ReadonlyArray<ScreenshotAnnotation>
  draft?: ScreenshotAnnotation
  selectedId?: string
  onSelect: (id: string) => void
  source: HTMLImageElement
}) {
  return (
    <>
      {[...annotations, ...(draft ? [draft] : [])].map((annotation) => {
        const selected = annotation.id === selectedId
        const common = {
          listening: annotation !== draft,
          onClick: (event: KonvaEventObject<MouseEvent>) => {
            event.cancelBubble = true
            onSelect(annotation.id)
          },
          onTap: (event: KonvaEventObject<TouchEvent>) => {
            event.cancelBubble = true
            onSelect(annotation.id)
          },
          opacity: annotation === draft ? 0.72 : 1,
          shadowBlur: selected ? 8 : 0,
          shadowColor: selected ? "#ffffff" : undefined,
          shadowOpacity: selected ? 0.85 : 0,
        }
        if (annotation.kind === "rectangle")
          return (
            <Rect
              {...common}
              key={annotation.id}
              height={annotation.height}
              stroke={annotation.color}
              strokeWidth={annotation.lineWidth}
              width={annotation.width}
              x={annotation.x}
              y={annotation.y}
            />
          )
        if (annotation.kind === "arrow")
          return (
            <Arrow
              {...common}
              key={annotation.id}
              fill={annotation.color}
              pointerLength={annotation.lineWidth * 4}
              pointerWidth={annotation.lineWidth * 3}
              points={[annotation.start.x, annotation.start.y, annotation.end.x, annotation.end.y]}
              stroke={annotation.color}
              strokeWidth={annotation.lineWidth}
            />
          )
        if (annotation.kind === "brush")
          return (
            <Line
              {...common}
              key={annotation.id}
              lineCap="round"
              lineJoin="round"
              points={[...annotation.points]}
              stroke={annotation.color}
              strokeWidth={annotation.lineWidth}
            />
          )
        if (annotation.kind === "text")
          return (
            <Text
              {...common}
              key={annotation.id}
              fill={annotation.color}
              fontFamily="HarmonyOS Sans SC"
              fontSize={annotation.fontSize}
              fontStyle="600"
              text={annotation.text}
              x={annotation.x}
              y={annotation.y}
            />
          )
        return (
          <MosaicNode annotation={annotation} common={common} key={annotation.id} source={source} />
        )
      })}
    </>
  )
}

function MosaicNode({
  annotation,
  common,
  source,
}: {
  annotation: MosaicAnnotation
  common: {
    listening: boolean
    onClick: (event: KonvaEventObject<MouseEvent>) => void
    onTap: (event: KonvaEventObject<TouchEvent>) => void
    opacity: number
    shadowBlur: number
    shadowColor?: string
    shadowOpacity: number
  }
  source: HTMLImageElement
}) {
  const imageRef = React.useRef<Konva.Image>(null)
  const pixelSize = Math.max(6, Math.round(Math.min(annotation.width, annotation.height) / 12))

  React.useLayoutEffect(() => {
    const image = imageRef.current
    if (!image) return
    image.clearCache()
    image.cache({ pixelRatio: 1 })
    image.getLayer()?.batchDraw()
    return () => {
      image.clearCache()
    }
  }, [annotation.height, annotation.width, pixelSize, source])

  return (
    <KonvaImage
      {...common}
      ref={imageRef}
      crop={{
        height: annotation.height,
        width: annotation.width,
        x: annotation.x,
        y: annotation.y,
      }}
      filters={[Konva.Filters.Pixelate]}
      height={annotation.height}
      image={source}
      pixelSize={pixelSize}
      stroke={annotation.color}
      strokeWidth={Math.max(1, annotation.lineWidth / 2)}
      width={annotation.width}
      x={annotation.x}
      y={annotation.y}
    />
  )
}
