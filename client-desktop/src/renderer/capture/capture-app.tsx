import * as React from "react"
import {
  ArrowUpRight,
  Brush,
  Check,
  Clipboard,
  Grid2X2,
  LoaderCircle,
  MessageSquare,
  MousePointer2,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react"
import { Image as KonvaImage, Layer, Rect, Stage } from "react-konva"
import type { KonvaEventObject } from "konva/lib/Node"
import {
  SCREENSHOT_LIMITS,
  type CaptureSessionMetadata,
  type ScreenshotOutputAction,
  type ScreenshotPoint,
  type ScreenshotRect,
} from "@shared/screenshot-contract"
import {
  clampSelection,
  createSelection,
  cssPointToImage,
  moveSelection,
  resizeSelection,
  type ResizeHandle,
} from "@shared/screenshot-geometry"
import { AnnotationLayer } from "./annotation-layer"
import {
  annotationColors,
  type AnnotationHistory,
  type CaptureTool,
  commitAnnotation,
  deleteAnnotation,
  emptyAnnotationHistory,
  redoAnnotationHistory,
  type ScreenshotAnnotation,
  undoAnnotationHistory,
} from "./capture-types"
import { renderCaptureResult } from "./render-result"

type Interaction =
  | Readonly<{ current?: ScreenshotRect; kind: "create"; start: ScreenshotPoint }>
  | Readonly<{
      current?: ScreenshotRect
      kind: "move"
      origin: ScreenshotRect
      start: ScreenshotPoint
    }>
  | Readonly<{
      current?: ScreenshotRect
      handle: ResizeHandle
      kind: "resize"
      origin: ScreenshotRect
      start: ScreenshotPoint
    }>
  | Readonly<{
      draft?: ScreenshotAnnotation
      kind: "draw"
      points: ReadonlyArray<number>
      start: ScreenshotPoint
      tool: Exclude<CaptureTool, "select" | "text">
    }>
  | Readonly<{ kind: "text"; point: ScreenshotPoint }>

const resizeHandles: ReadonlyArray<ResizeHandle> = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

type TextEditor = Readonly<{
  value: string
  x: number
  y: number
}>

export function CaptureApp() {
  const [metadata, setMetadata] = React.useState<CaptureSessionMetadata>()
  const [source, setSource] = React.useState<HTMLImageElement>()
  const [viewport, setViewport] = React.useState(() => ({ height: innerHeight, width: innerWidth }))
  const [selection, setSelection] = React.useState<ScreenshotRect>()
  const [tool, setTool] = React.useState<CaptureTool>("select")
  const [color, setColor] = React.useState<string>(annotationColors[0])
  const [history, setHistory] = React.useState<AnnotationHistory>(emptyAnnotationHistory)
  const [draft, setDraft] = React.useState<ScreenshotAnnotation>()
  const [selectedId, setSelectedId] = React.useState<string>()
  const [cursor, setCursor] = React.useState<ScreenshotPoint>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [output, setOutput] = React.useState<ScreenshotOutputAction>("copy")
  const [textEditor, setTextEditor] = React.useState<TextEditor>()
  const interactionRef = React.useRef<Interaction | undefined>(undefined)
  const frameRef = React.useRef<number | undefined>(undefined)
  const textInputRef = React.useRef<HTMLInputElement>(null)
  const scaleX = metadata ? viewport.width / metadata.display.imageWidth : 1
  const scaleY = metadata ? viewport.height / metadata.display.imageHeight : 1
  const textEditorWidth = Math.min(360, Math.max(1, viewport.width - 24))
  const textEditorHeight = 36

  function lineWidth(): number {
    return Math.max(2, 3 / Math.min(scaleX, scaleY))
  }

  function textFontSize(): number {
    const scale = Math.min(scaleX, scaleY)
    return Math.max(16, 18 / scale)
  }

  React.useEffect(() => {
    const capture = window.capture
    if (!capture) {
      setError("截图桥接不可用")
      return
    }
    void capture
      .getMetadata()
      .then((value) => {
        setMetadata(value)
        setOutput(value.defaultOutput)
        const image = new Image()
        image.crossOrigin = "anonymous"
        image.decoding = "async"
        image.onload = () => setSource(image)
        image.onerror = () => setError("无法读取屏幕截图")
        image.src = value.sourceUrl
      })
      .catch(() => setError("截图会话已失效"))
  }, [])

  React.useEffect(() => {
    if (!textEditor) return
    textInputRef.current?.focus()
  }, [textEditor])

  React.useEffect(() => {
    const resize = () => setViewport({ height: innerHeight, width: innerWidth })
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])

  function undo() {
    setHistory(undoAnnotationHistory)
    setSelectedId(undefined)
  }

  function redo() {
    setHistory(redoAnnotationHistory)
    setSelectedId(undefined)
  }

  function deleteSelected() {
    if (!selectedId) return
    setHistory((current) => deleteAnnotation(current, selectedId))
    setSelectedId(undefined)
  }

  function textAnnotation(value: string, point: ScreenshotPoint): ScreenshotAnnotation | undefined {
    const text = value.trim().slice(0, 160)
    if (!text) return undefined
    return {
      color,
      fontSize: textFontSize(),
      id: `text-${crypto.randomUUID()}`,
      kind: "text",
      lineWidth: lineWidth(),
      text,
      x: point.x,
      y: point.y,
    }
  }

  function commitTextEditor() {
    if (!textEditor) return
    const annotation = textAnnotation(textEditor.value, textEditor)
    setTextEditor(undefined)
    if (annotation) commit(annotation)
  }

  function textEditorPoint(point: ScreenshotPoint): ScreenshotPoint {
    const left = Math.min(
      Math.max(8, point.x * scaleX),
      Math.max(8, viewport.width - textEditorWidth - 8),
    )
    const top = Math.min(
      Math.max(8, point.y * scaleY),
      Math.max(8, viewport.height - textEditorHeight - 8),
    )
    return { x: left / scaleX, y: top / scaleY }
  }

  async function submit(action: ScreenshotOutputAction) {
    if (!selection || busy || !window.capture || !source) return
    setBusy(true)
    setError(undefined)
    setOutput(action)
    try {
      const pendingText = textEditor && textAnnotation(textEditor.value, textEditor)
      const annotations = pendingText ? [...history.present, pendingText] : history.present
      const bytes = await renderCaptureResult(source, selection, annotations)
      const totalChunks = Math.ceil(bytes.byteLength / SCREENSHOT_LIMITS.chunkBytes)
      await window.capture.resultStart({ action, totalBytes: bytes.byteLength, totalChunks })
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * SCREENSHOT_LIMITS.chunkBytes
        await window.capture.resultChunk(
          index,
          bytes.slice(start, Math.min(start + SCREENSHOT_LIMITS.chunkBytes, bytes.byteLength)),
        )
      }
      const result = await window.capture.resultFinish()
      if (result.status === "save-canceled") setBusy(false)
    } catch {
      setError("截图输出失败，请重试")
      setBusy(false)
    }
  }

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (busy) return
      if (event.key === "Escape") {
        event.preventDefault()
        void window.capture?.cancel()
      } else if (event.key === "Enter" && selection) {
        event.preventDefault()
        void submit(output)
      } else if ((event.key === "Backspace" || event.key === "Delete") && selectedId) {
        event.preventDefault()
        deleteSelected()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  })

  React.useEffect(
    () => () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  if (!metadata || !source)
    return (
      <main className="capture-loading" role={error ? "alert" : "status"}>
        {error ? <span>{error}</span> : <LoaderCircle aria-hidden="true" />}
      </main>
    )

  const handleWidth = 10 / scaleX
  const handleHeight = 10 / scaleY
  const selectionStroke = 2 / Math.min(scaleX, scaleY)

  function imagePoint(
    event: KonvaEventObject<MouseEvent | TouchEvent>,
  ): ScreenshotPoint | undefined {
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer || !metadata) return undefined
    return cssPointToImage(
      pointer,
      viewport.width,
      viewport.height,
      metadata.display.imageWidth,
      metadata.display.imageHeight,
    )
  }

  function handleDown(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (busy || !metadata) return
    const point = imagePoint(event)
    if (!point) return
    setCursor(point)
    const handleName = event.target.name().replace(/^resize-/, "")
    const handle = isResizeHandle(handleName) ? handleName : undefined
    if (tool === "select") {
      setSelectedId(undefined)
      if (selection && handle) {
        interactionRef.current = { handle, kind: "resize", origin: selection, start: point }
      } else if (selection && contains(selection, point)) {
        interactionRef.current = { kind: "move", origin: selection, start: point }
      } else {
        interactionRef.current = { kind: "create", start: point }
        setSelection({ height: 0, width: 0, x: point.x, y: point.y })
      }
      return
    }
    if (!selection || !contains(selection, point)) return
    if (tool === "text") {
      interactionRef.current = { kind: "text", point }
      return
    }
    interactionRef.current = { kind: "draw", points: [point.x, point.y], start: point, tool }
  }

  function handleMove(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    const point = imagePoint(event)
    if (!point || !metadata) return
    const interaction = interactionRef.current
    if (!interaction) return
    setCursor(point)
    if (interaction.kind === "text") return
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
    if (interaction.kind === "create") {
      const current = clampSelection(
        createSelection(interaction.start, point),
        metadata.display.imageWidth,
        metadata.display.imageHeight,
      )
      interactionRef.current = { ...interaction, current }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined
        setSelection(current)
      })
    } else if (interaction.kind === "move") {
      const current = moveSelection(
        interaction.origin,
        { x: point.x - interaction.start.x, y: point.y - interaction.start.y },
        metadata.display.imageWidth,
        metadata.display.imageHeight,
      )
      interactionRef.current = { ...interaction, current }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined
        setSelection(current)
      })
    } else if (interaction.kind === "resize") {
      const current = resizeSelection(
        interaction.origin,
        interaction.handle,
        { x: point.x - interaction.start.x, y: point.y - interaction.start.y },
        metadata.display.imageWidth,
        metadata.display.imageHeight,
        8 / Math.min(scaleX, scaleY),
      )
      interactionRef.current = { ...interaction, current }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined
        setSelection(current)
      })
    } else if (selection) {
      const bounded = clampPoint(point, selection)
      const points =
        interaction.tool === "brush"
          ? [...interaction.points, bounded.x, bounded.y]
          : interaction.points
      const next = annotationFromDrag(interaction.tool, interaction.start, bounded, points)
      interactionRef.current = { ...interaction, draft: next, points }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined
        setDraft(next)
      })
    }
  }

  function handleUp() {
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = undefined
    }
    const interaction = interactionRef.current
    interactionRef.current = undefined
    setCursor(undefined)
    if (interaction?.kind === "draw") {
      if (interaction.draft) commit(interaction.draft)
    } else if (interaction?.kind === "text") {
      setSelectedId(undefined)
      setTextEditor({ value: "", ...textEditorPoint(interaction.point) })
    } else if (interaction?.current) {
      setSelection(
        interaction.current.width < 2 || interaction.current.height < 2
          ? undefined
          : interaction.current,
      )
    } else if (interaction?.kind === "create") {
      setSelection(undefined)
    } else if (selection && (selection.width < 2 || selection.height < 2)) {
      setSelection(undefined)
    }
    setDraft(undefined)
  }

  function annotationFromDrag(
    kind: Exclude<CaptureTool, "select" | "text">,
    start: ScreenshotPoint,
    end: ScreenshotPoint,
    points: ReadonlyArray<number>,
  ): ScreenshotAnnotation {
    const base = { color, id: `draft-${kind}`, lineWidth: lineWidth() }
    if (kind === "arrow") return { ...base, end, kind, start }
    if (kind === "brush") return { ...base, kind, points }
    const rect = createSelection(start, end)
    return { ...base, ...rect, kind }
  }

  function commit(annotation: ScreenshotAnnotation) {
    const committed = { ...annotation, id: crypto.randomUUID() }
    setHistory((current) => commitAnnotation(current, committed))
    setSelectedId(committed.id)
  }

  return (
    <main className="capture-root">
      <Stage
        height={viewport.height}
        onMouseDown={handleDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        onMouseLeave={handleUp}
        onTouchEnd={handleUp}
        onTouchMove={handleMove}
        onTouchStart={handleDown}
        width={viewport.width}
      >
        <Layer scaleX={scaleX} scaleY={scaleY}>
          <KonvaImage
            height={metadata.display.imageHeight}
            image={source}
            listening={false}
            width={metadata.display.imageWidth}
          />
          {selection ? (
            <>
              <DimmedOutside
                imageHeight={metadata.display.imageHeight}
                imageWidth={metadata.display.imageWidth}
                selection={selection}
              />
              <AnnotationLayer
                annotations={history.present}
                draft={draft}
                onSelect={setSelectedId}
                selectedId={selectedId}
                source={source}
              />
              <Rect
                dash={[7 / scaleX, 5 / scaleX]}
                fill="transparent"
                height={selection.height}
                listening={false}
                stroke="#ffffff"
                strokeWidth={selectionStroke}
                width={selection.width}
                x={selection.x}
                y={selection.y}
              />
              {tool === "select" &&
                resizeHandles.map((handle) => {
                  const point = handlePoint(selection, handle)
                  return (
                    <Rect
                      fill="#ffffff"
                      height={handleHeight}
                      key={handle}
                      name={`resize-${handle}`}
                      shadowBlur={4 / Math.min(scaleX, scaleY)}
                      shadowColor="#000000"
                      stroke="#171717"
                      strokeWidth={1 / Math.min(scaleX, scaleY)}
                      width={handleWidth}
                      x={point.x - handleWidth / 2}
                      y={point.y - handleHeight / 2}
                    />
                  )
                })}
            </>
          ) : (
            <Rect
              fill="rgba(0,0,0,0.42)"
              height={metadata.display.imageHeight}
              listening={false}
              width={metadata.display.imageWidth}
            />
          )}
        </Layer>
      </Stage>

      {selection && (
        <div
          className="capture-size-label"
          style={{
            left: Math.min(viewport.width - 132, Math.max(8, selection.x * scaleX)),
            top: Math.min(viewport.height - 36, Math.max(8, selection.y * scaleY - 30)),
          }}
        >
          {Math.round(selection.width)} x {Math.round(selection.height)}
        </div>
      )}
      {textEditor && (
        <input
          aria-label="文本标注"
          className="capture-text-editor"
          maxLength={160}
          onBlur={commitTextEditor}
          onChange={(event) =>
            setTextEditor((current) =>
              current ? { ...current, value: event.target.value } : current,
            )
          }
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === "Escape") {
              event.preventDefault()
              setTextEditor(undefined)
            } else if (event.key === "Enter") {
              event.preventDefault()
              commitTextEditor()
            }
          }}
          ref={textInputRef}
          style={{
            color,
            fontSize: textFontSize() * Math.min(scaleX, scaleY),
            left: textEditor.x * scaleX,
            top: textEditor.y * scaleY,
            width: textEditorWidth,
          }}
          type="text"
          value={textEditor.value}
        />
      )}
      {cursor && (
        <div
          className="capture-magnifier"
          style={{
            backgroundImage: `url(${metadata.sourceUrl})`,
            backgroundPosition: `${-cursor.x * scaleX * 3 + 54}px ${-cursor.y * scaleY * 3 + 54}px`,
            backgroundSize: `${viewport.width * 3}px ${viewport.height * 3}px`,
            left: Math.min(viewport.width - 124, Math.max(12, cursor.x * scaleX + 20)),
            top: Math.min(viewport.height - 124, Math.max(12, cursor.y * scaleY + 20)),
          }}
        />
      )}

      <Toolbar
        busy={busy}
        color={color}
        canDelete={Boolean(selectedId)}
        canRedo={history.future.length > 0}
        canUndo={history.past.length > 0}
        hasConversation={metadata.defaultOutput === "conversation"}
        hasSelection={Boolean(selection)}
        onCancel={() => void window.capture?.cancel()}
        onColor={setColor}
        onDelete={deleteSelected}
        onOutput={(action) => void submit(action)}
        onRedo={redo}
        onTool={(nextTool) => {
          if (textEditor) commitTextEditor()
          setTool(nextTool)
        }}
        onUndo={undo}
        output={output}
        tool={tool}
      />
      {error && (
        <div className="capture-error" role="alert">
          {error}
        </div>
      )}
    </main>
  )
}

function Toolbar({
  busy,
  canDelete,
  canRedo,
  canUndo,
  color,
  hasConversation,
  hasSelection,
  onCancel,
  onColor,
  onDelete,
  onOutput,
  onRedo,
  onTool,
  onUndo,
  output,
  tool,
}: {
  busy: boolean
  canDelete: boolean
  canRedo: boolean
  canUndo: boolean
  color: string
  hasConversation: boolean
  hasSelection: boolean
  onCancel: () => void
  onColor: (color: string) => void
  onDelete: () => void
  onOutput: (action: ScreenshotOutputAction) => void
  onRedo: () => void
  onTool: (tool: CaptureTool) => void
  onUndo: () => void
  output: ScreenshotOutputAction
  tool: CaptureTool
}) {
  const tools = [
    ["select", MousePointer2, "选择"],
    ["rectangle", Square, "矩形"],
    ["arrow", ArrowUpRight, "箭头"],
    ["brush", Brush, "画笔"],
    ["text", Type, "文本"],
    ["mosaic", Grid2X2, "马赛克"],
  ] as const
  return (
    <div className="capture-toolbar-shell">
      <div aria-label="截图工具栏" className="capture-toolbar" role="toolbar">
        <ToolButton label="取消" onClick={onCancel}>
          <X />
        </ToolButton>
        <span className="capture-separator" />
        {tools.map(([value, Icon, label]) => (
          <ToolButton
            active={tool === value}
            disabled={busy}
            key={value}
            label={label}
            onClick={() => onTool(value)}
          >
            <Icon />
          </ToolButton>
        ))}
        <span className="capture-separator" />
        <div aria-label="标注颜色" className="capture-swatches" role="group">
          {annotationColors.map((value) => (
            <button
              aria-label={`使用颜色 ${value}`}
              aria-pressed={color === value}
              className="capture-swatch"
              key={value}
              onClick={() => onColor(value)}
              style={{ backgroundColor: value }}
              type="button"
            />
          ))}
        </div>
        <span className="capture-separator" />
        <ToolButton disabled={!canUndo || busy} label="撤销" onClick={onUndo}>
          <Undo2 />
        </ToolButton>
        <ToolButton disabled={!canRedo || busy} label="重做" onClick={onRedo}>
          <Redo2 />
        </ToolButton>
        <ToolButton disabled={!canDelete || busy} label="删除标注" onClick={onDelete}>
          <Trash2 />
        </ToolButton>
        <span className="capture-separator" />
        <ToolButton
          active={output === "copy"}
          disabled={!hasSelection || busy}
          label="复制"
          onClick={() => onOutput("copy")}
        >
          <Clipboard />
        </ToolButton>
        <ToolButton
          active={output === "save"}
          disabled={!hasSelection || busy}
          label="保存"
          onClick={() => onOutput("save")}
        >
          <Save />
        </ToolButton>
        {hasConversation && (
          <ToolButton
            active={output === "conversation"}
            disabled={!hasSelection || busy}
            label="添加到当前对话"
            onClick={() => onOutput("conversation")}
          >
            <MessageSquare />
          </ToolButton>
        )}
        <ToolButton
          active
          disabled={!hasSelection || busy}
          label="确认当前操作"
          onClick={() => onOutput(output)}
        >
          {busy ? <LoaderCircle className="capture-spin" /> : <Check />}
        </ToolButton>
      </div>
    </div>
  )
}

function ToolButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: React.PropsWithChildren<{
  active?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}>) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className="capture-tool-button"
      data-active={active || undefined}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function DimmedOutside({
  imageHeight,
  imageWidth,
  selection,
}: {
  imageHeight: number
  imageWidth: number
  selection: ScreenshotRect
}) {
  const fill = "rgba(0,0,0,0.48)"
  return (
    <>
      <Rect fill={fill} height={selection.y} listening={false} width={imageWidth} />
      <Rect
        fill={fill}
        height={imageHeight - selection.y - selection.height}
        listening={false}
        width={imageWidth}
        y={selection.y + selection.height}
      />
      <Rect
        fill={fill}
        height={selection.height}
        listening={false}
        width={selection.x}
        y={selection.y}
      />
      <Rect
        fill={fill}
        height={selection.height}
        listening={false}
        width={imageWidth - selection.x - selection.width}
        x={selection.x + selection.width}
        y={selection.y}
      />
    </>
  )
}

function handlePoint(selection: ScreenshotRect, handle: ResizeHandle): ScreenshotPoint {
  const horizontal = handle.includes("w")
    ? selection.x
    : handle.includes("e")
      ? selection.x + selection.width
      : selection.x + selection.width / 2
  const vertical = handle.includes("n")
    ? selection.y
    : handle.includes("s")
      ? selection.y + selection.height
      : selection.y + selection.height / 2
  return { x: horizontal, y: vertical }
}

function contains(rect: ScreenshotRect, point: ScreenshotPoint): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.width &&
    point.y <= rect.y + rect.height
  )
}

function clampPoint(point: ScreenshotPoint, rect: ScreenshotRect): ScreenshotPoint {
  return {
    x: Math.min(Math.max(point.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(point.y, rect.y), rect.y + rect.height),
  }
}

function isResizeHandle(value: string): value is ResizeHandle {
  return (
    value === "e" ||
    value === "n" ||
    value === "ne" ||
    value === "nw" ||
    value === "s" ||
    value === "se" ||
    value === "sw" ||
    value === "w"
  )
}
