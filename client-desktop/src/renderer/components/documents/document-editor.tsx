import * as React from "react"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import { DragHandle, type DragHandleProps } from "@tiptap/extension-drag-handle-react"
import Highlight from "@tiptap/extension-highlight"
import Placeholder from "@tiptap/extension-placeholder"
import TaskList from "@tiptap/extension-task-list"
import { TableKit } from "@tiptap/extension-table"
import TextAlign from "@tiptap/extension-text-align"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import type { HocuspocusProvider } from "@hocuspocus/provider"
import { toast } from "sonner"
import type * as Y from "yjs"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paintbrush,
  PaintRoller,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Sheet,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { limitDocumentTitle } from "@/lib/document-title-controller"
import { safePresenceColor, type DocumentPresenceUser } from "@/lib/document-presence"
import { DocumentControlSeparator } from "./document-control-separator"
import { isDocumentBlockTransformable } from "./document-block-utils"
import { DocumentHorizontalRule } from "./document-horizontal-rule-extension"
import { DocumentImage } from "./document-image-extension"
import { DocumentImageResolutionContext } from "./document-image-resolution"
import { DocumentTaskItem } from "./document-task-item-extension"
import { sanitizeDocumentPasteHTML } from "./document-paste-sanitizer"
import { useDocumentImageResolutions } from "./use-document-image-resolutions"

import "./document-editor.css"

export function DocumentEditor({
  collaborationDocument,
  collaborationProvider,
  collaborationUser,
  onTitleBlur,
  onTitleChange,
  readOnly = false,
  title,
}: {
  collaborationDocument: Y.Doc
  collaborationProvider?: HocuspocusProvider
  collaborationUser?: DocumentPresenceUser
  onTitleBlur(): void
  onTitleChange(title: string): void
  readOnly?: boolean
  title: string
}) {
  const editor = useEditor(
    {
      editable: !readOnly,
      editorProps: {
        attributes: { "aria-label": "文档正文", class: "document-editor-content" },
        handleClick: (_view, _pos, event) => {
          if ((event.target as Element | null)?.closest("a")) event.preventDefault()
          return false
        },
        transformPastedHTML: sanitizeDocumentPasteHTML,
      },
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          horizontalRule: false,
          link: { openOnClick: false },
          undoRedo: false,
        }),
        Collaboration.configure({ fragment: collaborationDocument.getXmlFragment("body") }),
        ...(collaborationProvider && collaborationUser
          ? [
              CollaborationCaret.configure({
                provider: collaborationProvider,
                render: renderCollaborationCaret,
                selectionRender: renderCollaborationSelection,
                user: collaborationUser,
              }),
            ]
          : []),
        DocumentHorizontalRule,
        DocumentImage,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        TextAlign.configure({
          alignments: ["left", "center", "right"],
          types: ["heading", "paragraph"],
        }),
        TaskList,
        DocumentTaskItem,
        TableKit.configure({ table: { resizable: true } }),
        Placeholder.configure({ placeholder: "开始撰写文档..." }),
      ],
      shouldRerenderOnTransaction: false,
    },
    [collaborationDocument, collaborationProvider, collaborationUser?.id, readOnly],
  )
  const imageResolutions = useDocumentImageResolutions(editor)

  React.useEffect(() => () => editor?.destroy(), [editor])
  if (!editor) return <div className="p-8 text-sm text-muted-foreground">正在初始化编辑器</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DocumentToolbar editor={editor} />
      <div
        className="document-workspace-canvas min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="document-workspace-canvas"
      >
        <div className="document-editor mx-auto min-h-full max-w-4xl border bg-background px-8 py-12 shadow-md sm:px-14 sm:py-16">
          <input
            aria-label="文档页面标题"
            className="mb-8 w-full border-b bg-transparent pb-5 text-4xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60"
            disabled={readOnly}
            onBlur={onTitleBlur}
            onChange={(event) => onTitleChange(limitDocumentTitle(event.target.value))}
            placeholder="无标题文档"
            value={title}
          />
          <DocumentImageResolutionContext.Provider value={imageResolutions}>
            <EditorContent editor={editor} />
          </DocumentImageResolutionContext.Provider>
          {!readOnly && <DocumentBlockHandle editor={editor} />}
        </div>
      </div>
    </div>
  )
}

function renderCollaborationCaret(user: Record<string, unknown>) {
  const color = safePresenceColor(user.color)
  const cursor = document.createElement("span")
  cursor.className = "collaboration-carets__caret"
  cursor.style.borderColor = color
  const label = document.createElement("span")
  label.className = "collaboration-carets__label"
  label.style.backgroundColor = color
  label.textContent = typeof user.name === "string" ? user.name : "协作者"
  cursor.append(label)
  return cursor
}

function renderCollaborationSelection(user: Record<string, unknown>) {
  return {
    class: "collaboration-carets__selection",
    nodeName: "span",
    style: `background-color: ${safePresenceColor(user.color)}38`,
  }
}

type SelectionRange = { from: number; to: number }

/**
 * Tiptap 在 EditorContent 挂载前或编辑器销毁后会通过代理暴露 view。
 * 代理只允许读取少数属性，读取 dom、nodeDOM 等属性会直接抛错。
 */
function getMountedEditorView(editor: Editor): Editor["view"] | null {
  if (editor.isDestroyed) return null

  try {
    const view = editor.view
    return view.isDestroyed ? null : view
  } catch {
    return null
  }
}

function getMountedEditorViewDom(editor: Editor): HTMLElement | null {
  const view = getMountedEditorView(editor)
  if (!view) return null

  try {
    const dom = view.dom
    return dom instanceof HTMLElement ? dom : null
  } catch {
    return null
  }
}

function DocumentToolbar({ editor }: { editor: Editor }) {
  const [formatPainterActive, setFormatPainterActive] = React.useState(false)
  const formatPainterRef = React.useRef<TextFormatSnapshot | null>(null)
  const formatPainterSourceRef = React.useRef<SelectionRange | null>(null)
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  })
  const paragraphAlign = editor.getAttributes("paragraph").textAlign as string | undefined
  const headingAlign = editor.getAttributes("heading").textAlign as string | undefined
  const activeAlign = paragraphAlign ?? headingAlign
  const currentAlign: TextAlignment =
    activeAlign === "center" || activeAlign === "right" ? activeAlign : "left"

  React.useEffect(() => {
    const editorDom = getMountedEditorViewDom(editor)
    if (!editorDom) return

    if (!formatPainterActive) {
      editorDom.classList.remove("document-format-painter-active")
      return
    }

    let animationFrame: number | null = null
    const cancelFormatPainter = () => {
      formatPainterRef.current = null
      formatPainterSourceRef.current = null
      setFormatPainterActive(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelFormatPainter()
    }
    const handleMouseUp = () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        if (!getMountedEditorView(editor)) return

        const snapshot = formatPainterRef.current
        const source = formatPainterSourceRef.current
        const { from, to } = editor.state.selection
        if (!snapshot || from === to) return
        if (source && source.from === from && source.to === to) return

        applyTextFormat(editor, snapshot)
        cancelFormatPainter()
      })
    }

    editorDom.classList.add("document-format-painter-active")
    editorDom.addEventListener("keydown", handleKeyDown)
    editorDom.addEventListener("mouseup", handleMouseUp)
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      editorDom.classList.remove("document-format-painter-active")
      editorDom.removeEventListener("keydown", handleKeyDown)
      editorDom.removeEventListener("mouseup", handleMouseUp)
    }
  }, [editor, formatPainterActive])

  function toggleFormatPainter() {
    if (formatPainterActive) {
      formatPainterRef.current = null
      formatPainterSourceRef.current = null
      setFormatPainterActive(false)
      return
    }

    formatPainterRef.current = captureTextFormat(editor)
    formatPainterSourceRef.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    }
    setFormatPainterActive(true)
  }

  function clearFormatting() {
    formatPainterRef.current = null
    formatPainterSourceRef.current = null
    setFormatPainterActive(false)
    editor.chain().focus().unsetAllMarks().clearNodes().run()
  }

  return (
    <div
      aria-label="文档格式工具栏"
      className="document-toolbar no-drag h-12 shrink-0 overflow-x-auto border-b bg-background"
      role="toolbar"
    >
      <div className="document-toolbar__content mx-auto flex h-full w-max min-w-max items-center gap-0.5 px-3 py-1.5">
        <ToolbarButton
          disabled={!editor.can().chain().focus().undo().run()}
          label="撤销"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton
          disabled={!editor.can().chain().focus().redo().run()}
          label="重做"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 />
        </ToolbarButton>
        <DocumentControlSeparator />
        <ToolbarButton
          active={formatPainterActive}
          label={formatPainterActive ? "取消格式刷" : "格式刷"}
          onClick={toggleFormatPainter}
        >
          <PaintRoller />
        </ToolbarButton>
        <ToolbarButton label="清除格式" onClick={clearFormatting}>
          <RemoveFormatting />
        </ToolbarButton>
        <DocumentControlSeparator />
        <ToolbarButton
          active={editor.isActive("bold")}
          label="粗体"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          label="斜体"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          label="下划线"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("strike")}
          label="删除线"
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </ToolbarButton>
        <TextColorMenu editor={editor} />
        <TextHighlightMenu editor={editor} />
        <DocumentControlSeparator />
        <ToolbarButton
          active={editor.isActive("bulletList")}
          label="无序列表"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          label="有序列表"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("taskList")}
          label="待办列表"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListTodo />
        </ToolbarButton>
        <DocumentControlSeparator />
        <TextAlignmentMenu currentAlign={currentAlign} editor={editor} />
        <DocumentControlSeparator />
        <LinkMenu editor={editor} />
        <DocumentControlSeparator />
        <HorizontalRuleMenu editor={editor} />
        <TableInsertMenu editor={editor} />
        <ImageInsertButton editor={editor} />
      </div>
    </div>
  )
}

function HorizontalRuleMenu({ editor }: { editor: Editor }) {
  const [lineStyle, setLineStyle] = React.useState<"dashed" | "dotted" | "double" | "solid">(
    "solid",
  )
  const [thickness, setThickness] = React.useState(1)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label="插入分割线" size="icon-sm" title="插入分割线" variant="ghost">
          <Minus />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">线条样式</legend>
          <div className="grid grid-cols-2 gap-1">
            {(["solid", "dashed", "dotted", "double"] as const).map((value) => (
              <Button
                aria-pressed={lineStyle === value}
                key={value}
                onClick={() => setLineStyle(value)}
                size="sm"
                type="button"
                variant={lineStyle === value ? "secondary" : "ghost"}
              >
                {value === "solid"
                  ? "实线"
                  : value === "dashed"
                    ? "虚线"
                    : value === "dotted"
                      ? "点线"
                      : "双线"}
              </Button>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-2 text-sm">
          粗细：{thickness} 像素
          <input
            aria-label="分割线粗细"
            className="w-full"
            max={6}
            min={1}
            onChange={(event) => setThickness(Number(event.target.value))}
            type="range"
            value={thickness}
          />
        </label>
        <Button
          className="w-full"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({ type: "horizontalRule", attrs: { lineStyle, thickness } })
              .run()
          }
          size="sm"
        >
          插入分割线
        </Button>
      </PopoverContent>
    </Popover>
  )
}

type TextAlignment = "center" | "left" | "right"

const textAlignmentOptions = [
  { icon: AlignLeft, label: "左对齐", value: "left" },
  { icon: AlignCenter, label: "居中对齐", value: "center" },
  { icon: AlignRight, label: "右对齐", value: "right" },
] as const

function TextAlignmentMenu({
  currentAlign,
  editor,
}: {
  currentAlign: TextAlignment
  editor: Editor
}) {
  const currentOption =
    textAlignmentOptions.find((option) => option.value === currentAlign) ?? textAlignmentOptions[0]
  const CurrentIcon = currentOption.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`文本对齐：${currentOption.label}`}
          className="gap-1 px-2"
          size="sm"
          title={currentOption.label}
          type="button"
          variant="ghost"
        >
          <CurrentIcon />
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        {textAlignmentOptions.map((option) => (
          <DropdownMenuItem
            className={cn(currentAlign === option.value && "bg-muted")}
            key={option.value}
            onSelect={() => editor.chain().focus().setTextAlign(option.value).run()}
          >
            <option.icon />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ImageInsertButton({ editor }: { editor: Editor }) {
  function insertPlaceholder() {
    const inserted = editor
      .chain()
      .focus()
      .insertContent({
        attrs: { alt: "", externalUrl: null, fileId: null },
        type: DocumentImage.name,
      })
      .run()
    if (!inserted) toast.error("无法在当前位置插入图片")
  }

  return (
    <ToolbarButton label="插入图片" onClick={insertPlaceholder}>
      <ImagePlus />
    </ToolbarButton>
  )
}

const maximumTableRows = 10
const maximumTableColumns = 10

function TableInsertMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = React.useState(false)
  const [selection, setSelection] = React.useState({ columns: 3, rows: 3 })
  const cellRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const canInsert = editor
    .can()
    .chain()
    .focus()
    .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
    .run()

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) setSelection({ columns: 3, rows: 3 })
  }

  function insertTable(rows: number, columns: number) {
    const inserted = editor
      .chain()
      .focus()
      .insertTable({ cols: columns, rows, withHeaderRow: true })
      .run()
    if (inserted) setOpen(false)
  }

  function focusCell(rows: number, columns: number) {
    const nextSelection = {
      columns: Math.min(Math.max(columns, 1), maximumTableColumns),
      rows: Math.min(Math.max(rows, 1), maximumTableRows),
    }
    setSelection(nextSelection)
    requestAnimationFrame(() => {
      cellRefs.current.get(tableCellKey(nextSelection.rows, nextSelection.columns))?.focus()
    })
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label="插入表格"
          disabled={!canInsert}
          size="icon-sm"
          title="插入表格"
          type="button"
          variant="ghost"
        >
          <Sheet />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto p-3">
        <div className="mb-2 flex items-center justify-between gap-6 text-xs">
          <span className="font-medium">插入表格</span>
          <span className="text-muted-foreground">
            {selection.rows} × {selection.columns}
          </span>
        </div>
        <div aria-label="选择表格行列数量" className="grid grid-cols-10 gap-1" role="grid">
          {Array.from({ length: maximumTableRows }, (_, rowIndex) =>
            Array.from({ length: maximumTableColumns }, (_, columnIndex) => {
              const rows = rowIndex + 1
              const columns = columnIndex + 1
              const selected = rows <= selection.rows && columns <= selection.columns
              const active = rows === selection.rows && columns === selection.columns
              const key = tableCellKey(rows, columns)
              return (
                <button
                  aria-label={`${rows} 行 ${columns} 列`}
                  aria-pressed={active}
                  className={cn(
                    "size-5 rounded-sm border transition-colors",
                    selected
                      ? "border-sky-500 bg-sky-100 dark:bg-sky-950"
                      : "border-border bg-background hover:border-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/50",
                  )}
                  key={key}
                  onClick={() => insertTable(rows, columns)}
                  onFocus={() => setSelection({ columns, rows })}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") focusCell(rows - 1, columns)
                    else if (event.key === "ArrowDown") focusCell(rows + 1, columns)
                    else if (event.key === "ArrowLeft") focusCell(rows, columns - 1)
                    else if (event.key === "ArrowRight") focusCell(rows, columns + 1)
                    else return
                    event.preventDefault()
                  }}
                  onMouseEnter={() => setSelection({ columns, rows })}
                  ref={(element) => {
                    if (element) cellRefs.current.set(key, element)
                    else cellRefs.current.delete(key)
                  }}
                  role="gridcell"
                  tabIndex={active ? 0 : -1}
                  type="button"
                />
              )
            }),
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function tableCellKey(rows: number, columns: number) {
  return `${rows}:${columns}`
}

type TextFormatSnapshot = Readonly<{
  marks: ReadonlyArray<Readonly<{ attrs: Record<string, unknown>; type: string }>>
  textAlign: "center" | "left" | "right"
}>

function captureTextFormat(editor: Editor): TextFormatSnapshot {
  const { selection, storedMarks } = editor.state
  let marks = selection.empty ? (storedMarks ?? selection.$from.marks()) : null
  if (!marks) {
    editor.state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (!marks && node.isText) marks = node.marks
    })
  }
  const alignment =
    editor.getAttributes("paragraph").textAlign ?? editor.getAttributes("heading").textAlign
  return {
    marks: (marks ?? [])
      .filter((mark) => mark.type.name !== "link")
      .map((mark) => ({ attrs: { ...mark.attrs }, type: mark.type.name })),
    textAlign: alignment === "center" || alignment === "right" ? alignment : "left",
  }
}

function applyTextFormat(editor: Editor, snapshot: TextFormatSnapshot): void {
  let chain = editor.chain().focus().unsetAllMarks()
  for (const mark of snapshot.marks) chain = chain.setMark(mark.type, mark.attrs)
  if (snapshot.textAlign === "left") chain.unsetTextAlign().run()
  else chain.setTextAlign(snapshot.textAlign).run()
}

function ToolbarButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  disabled?: boolean
  label: string
  onClick(): void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          aria-pressed={active || undefined}
          className={cn(active && "bg-muted text-foreground")}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const documentColorShades = [100, 300, 500, 700, 900] as const

const documentColorRows = [
  {
    name: "red",
    values: [
      "oklch(93.6% 0.032 17.717)",
      "oklch(80.8% 0.114 19.571)",
      "oklch(63.7% 0.237 25.331)",
      "oklch(50.5% 0.213 27.518)",
      "oklch(39.6% 0.141 25.723)",
    ],
  },
  {
    name: "amber",
    values: [
      "oklch(96.2% 0.059 95.617)",
      "oklch(87.9% 0.169 91.605)",
      "oklch(76.9% 0.188 70.08)",
      "oklch(55.5% 0.163 48.998)",
      "oklch(41.4% 0.112 45.904)",
    ],
  },
  {
    name: "lime",
    values: [
      "oklch(96.7% 0.067 122.328)",
      "oklch(89.7% 0.196 126.665)",
      "oklch(76.8% 0.233 130.85)",
      "oklch(53.2% 0.157 131.589)",
      "oklch(40.5% 0.101 131.063)",
    ],
  },
  {
    name: "emerald",
    values: [
      "oklch(95% 0.052 163.051)",
      "oklch(84.5% 0.143 164.978)",
      "oklch(69.6% 0.17 162.48)",
      "oklch(50.8% 0.118 165.612)",
      "oklch(37.8% 0.077 168.94)",
    ],
  },
  {
    name: "cyan",
    values: [
      "oklch(95.6% 0.045 203.388)",
      "oklch(86.5% 0.127 207.078)",
      "oklch(71.5% 0.143 215.221)",
      "oklch(52% 0.105 223.128)",
      "oklch(39.8% 0.07 227.392)",
    ],
  },
  {
    name: "blue",
    values: [
      "oklch(93.2% 0.032 255.585)",
      "oklch(80.9% 0.105 251.813)",
      "oklch(62.3% 0.214 259.815)",
      "oklch(48.8% 0.243 264.376)",
      "oklch(37.9% 0.146 265.522)",
    ],
  },
  {
    name: "violet",
    values: [
      "oklch(94.3% 0.029 294.588)",
      "oklch(81.1% 0.111 293.571)",
      "oklch(60.6% 0.25 292.717)",
      "oklch(49.1% 0.27 292.581)",
      "oklch(38% 0.189 293.745)",
    ],
  },
  {
    name: "fuchsia",
    values: [
      "oklch(95.2% 0.037 318.852)",
      "oklch(83.3% 0.145 321.434)",
      "oklch(66.7% 0.295 322.15)",
      "oklch(51.8% 0.253 323.949)",
      "oklch(40.1% 0.17 325.612)",
    ],
  },
  {
    name: "olive",
    values: [
      "oklch(96.6% 0.005 106.5)",
      "oklch(88% 0.011 106.6)",
      "oklch(58% 0.031 107.3)",
      "oklch(39.4% 0.023 107.4)",
      "oklch(22.8% 0.013 107.4)",
    ],
  },
  {
    name: "gray",
    values: [
      "oklch(96.7% 0.003 264.542)",
      "oklch(87.2% 0.01 258.338)",
      "oklch(55.1% 0.027 264.364)",
      "oklch(37.3% 0.034 259.733)",
      "oklch(21% 0.034 264.665)",
    ],
  },
] as const

const documentColors = documentColorShades.flatMap((shade, shadeIndex) =>
  documentColorRows.map((row) => ({
    label: `${row.name} ${shade}`,
    value: row.values[shadeIndex],
  })),
)

function DocumentColorPalette({
  label,
  onColorSelect,
  resetLabel,
  resetSwatchClassName,
}: {
  label: string
  onColorSelect: (color: string | null) => void
  resetLabel: string
  resetSwatchClassName: string
}) {
  return (
    <DropdownMenuContent align="center" className="w-auto">
      <div className="flex items-center justify-between gap-3 px-1">
        <DropdownMenuLabel className="px-1">{label}</DropdownMenuLabel>
        <DropdownMenuItem className="h-7 px-2" onSelect={() => onColorSelect(null)}>
          <span className={cn("size-4 rounded-full border", resetSwatchClassName)} />
          {resetLabel}
        </DropdownMenuItem>
      </div>
      <DropdownMenuSeparator />
      <div className="grid grid-cols-10 gap-0.5 p-1">
        {documentColors.map((color) => (
          <DropdownMenuItem
            aria-label={color.label}
            className="size-6 justify-center rounded-full p-0"
            key={color.label}
            onSelect={() => onColorSelect(color.value)}
            title={color.label}
          >
            <span
              className="size-4 rounded-full border border-black/10"
              style={{ backgroundColor: color.value }}
            />
          </DropdownMenuItem>
        ))}
      </div>
    </DropdownMenuContent>
  )
}

function TextColorMenu({ editor }: { editor: Editor }) {
  function setTextColor(color: string | null) {
    if (color) editor.chain().focus().setColor(color).run()
    else editor.chain().focus().unsetColor().run()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="字体颜色" size="icon-sm" title="字体颜色" type="button" variant="ghost">
          <Baseline />
        </Button>
      </DropdownMenuTrigger>
      <DocumentColorPalette
        label="字体颜色"
        onColorSelect={setTextColor}
        resetLabel="默认颜色"
        resetSwatchClassName="bg-foreground"
      />
    </DropdownMenu>
  )
}

function TextHighlightMenu({ editor }: { editor: Editor }) {
  function setTextHighlight(color: string | null) {
    if (color) editor.chain().focus().setHighlight({ color }).run()
    else editor.chain().focus().unsetHighlight().run()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="文字背景色"
          size="icon-sm"
          title="文字背景色"
          type="button"
          variant="ghost"
        >
          <Paintbrush />
        </Button>
      </DropdownMenuTrigger>
      <DocumentColorPalette
        label="文字背景色"
        onColorSelect={setTextHighlight}
        resetLabel="无背景色"
        resetSwatchClassName="bg-background"
      />
    </DropdownMenu>
  )
}

function LinkMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState("")
  const linkActive = editor.isActive("link")

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const href = editor.getAttributes("link").href
      setUrl(typeof href === "string" ? href : "")
    }
    setOpen(nextOpen)
  }

  function applyLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = url.trim()
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      setOpen(false)
      return
    }

    const href = /^(https?:\/\/|mailto:|tel:)/i.test(value) ? value : `https://${value}`
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    setOpen(false)
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    setOpen(false)
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label="链接"
          aria-pressed={linkActive || undefined}
          className={cn(linkActive && "bg-muted text-foreground")}
          size="icon-sm"
          title="链接"
          type="button"
          variant="ghost"
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 p-3">
        <form className="flex items-center gap-2" onSubmit={applyLink}>
          <Input
            aria-label="链接地址"
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            placeholder="输入链接地址"
            value={url}
          />
          <Button size="sm" type="submit">
            应用
          </Button>
          {linkActive && (
            <Button
              aria-label="移除链接"
              onClick={removeLink}
              size="icon-sm"
              title="移除链接"
              type="button"
              variant="ghost"
            >
              <Unlink />
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}

function DocumentBlockHandle({ editor }: { editor: Editor }) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const activeBlockElementRef = React.useRef<Element | null>(null)
  const handleHoveredRef = React.useRef(false)
  const [activeBlock, setActiveBlock] = React.useState<{
    nodeSize: number
    pos: number
  } | null>(null)
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  })

  const handleNodeChange = React.useCallback<NonNullable<DragHandleProps["onNodeChange"]>>(
    ({ node, pos }) => {
      activeBlockElementRef.current?.classList.remove("document-block-active")
      const view = getMountedEditorView(editor)
      const nodeDOM = node && view ? view.nodeDOM(pos) : null
      activeBlockElementRef.current =
        nodeDOM instanceof Element
          ? nodeDOM
          : nodeDOM?.parentElement instanceof Element
            ? nodeDOM.parentElement
            : null
      if (handleHoveredRef.current) {
        activeBlockElementRef.current?.classList.add("document-block-active")
      }
      setActiveBlock(node ? { nodeSize: node.nodeSize, pos } : null)
    },
    [editor],
  )

  function setBlockHighlight(highlighted: boolean) {
    handleHoveredRef.current = highlighted
    activeBlockElementRef.current?.classList.toggle("document-block-active", highlighted)
  }

  function handleMenuOpenChange(open: boolean) {
    setMenuOpen(open)
    editor.commands.setMeta("lockDragHandle", open)
  }

  function duplicateBlock() {
    if (!activeBlock) return
    const node = editor.state.doc.nodeAt(activeBlock.pos)
    if (!node) return

    const insertPos = activeBlock.pos + activeBlock.nodeSize
    const view = getMountedEditorView(editor)
    if (!view) return
    view.dispatch(editor.state.tr.insert(insertPos, node.copy(node.content)).scrollIntoView())
    editor.commands.focus(insertPos + 1)
  }

  function deleteBlock() {
    if (!activeBlock) return
    editor.chain().focus().setNodeSelection(activeBlock.pos).deleteSelection().run()
  }

  function transformBlock(format: BlockFormat) {
    if (!activeBlock) return
    const node = editor.state.doc.nodeAt(activeBlock.pos)
    if (!node || !isDocumentBlockTransformable(node)) return

    let selectionPos = activeBlock.pos + 1
    let selectionNode = node
    while (!selectionNode.isTextblock) {
      const firstChild = selectionNode.firstChild
      if (!firstChild) break
      selectionNode = firstChild
      selectionPos += 1
    }
    editor.commands.setTextSelection(selectionPos)

    if (editor.isActive("bulletList")) editor.chain().focus().toggleBulletList().run()
    if (editor.isActive("orderedList")) editor.chain().focus().toggleOrderedList().run()
    if (editor.isActive("taskList")) editor.chain().focus().toggleTaskList().run()
    if (editor.isActive("blockquote")) editor.chain().focus().toggleBlockquote().run()
    if (editor.isActive("codeBlock")) editor.chain().focus().toggleCodeBlock().run()

    editor.chain().focus().setParagraph().run()

    switch (format) {
      case "paragraph":
        return
      case "heading-1":
        editor.chain().focus().setHeading({ level: 1 }).run()
        return
      case "heading-2":
        editor.chain().focus().setHeading({ level: 2 }).run()
        return
      case "heading-3":
        editor.chain().focus().setHeading({ level: 3 }).run()
        return
      case "bullet-list":
        editor.chain().focus().toggleBulletList().run()
        return
      case "ordered-list":
        editor.chain().focus().toggleOrderedList().run()
        return
      case "task-list":
        editor.chain().focus().toggleTaskList().run()
        return
      case "blockquote":
        editor.chain().focus().toggleBlockquote().run()
        return
      case "code-block":
        editor.chain().focus().toggleCodeBlock().run()
    }
  }

  const activeBlockNode = activeBlock ? editor.state.doc.nodeAt(activeBlock.pos) : null
  const canTransformActiveBlock = isDocumentBlockTransformable(activeBlockNode)

  return (
    <DragHandle
      className="document-block-handle"
      editor={editor}
      nested
      onNodeChange={handleNodeChange}
    >
      <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="块操作"
            className="cursor-grab bg-background shadow-xs active:cursor-grabbing"
            onMouseEnter={() => setBlockHighlight(true)}
            onMouseLeave={() => setBlockHighlight(false)}
            size="icon-xs"
            title="点击打开菜单，拖动调整位置"
            type="button"
            variant="outline"
          >
            <GripVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36" side="left">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!canTransformActiveBlock}>
              <Pilcrow />
              转换为
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuItem onSelect={() => transformBlock("paragraph")}>
                <Pilcrow />
                正文
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-1")}>
                <Heading1 />
                一级标题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-2")}>
                <Heading2 />
                二级标题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-3")}>
                <Heading3 />
                三级标题
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => transformBlock("bullet-list")}>
                <List />
                无序列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("ordered-list")}>
                <ListOrdered />
                有序列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("task-list")}>
                <ListTodo />
                待办列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("blockquote")}>
                <Quote />
                引用
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("code-block")}>
                <Code />
                代码块
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={duplicateBlock}>
            <Copy />
            复制块
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={deleteBlock} variant="destructive">
            <Trash2 />
            删除块
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DragHandle>
  )
}

type BlockFormat =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"
