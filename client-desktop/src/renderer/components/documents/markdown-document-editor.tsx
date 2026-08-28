import * as React from "react"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import type { HocuspocusProvider } from "@hocuspocus/provider"
import CodeMirror from "@uiw/react-codemirror"
import {
  Bold,
  Columns2,
  Eye,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pencil,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react"
import * as Y from "yjs"
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next"

import { MessageMarkdown } from "@/components/message-markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DocumentControlSeparator } from "@/components/documents/document-control-separator"
import {
  transformMarkdownList,
  type MarkdownListType,
} from "@/components/documents/markdown-document-list-command"
import { MarkdownTableInsertMenu } from "@/components/documents/markdown-table-insert-menu"
import { useLocale } from "@/components/locale-provider"
import { cn } from "@/lib/utils"

import "./markdown-document-editor.css"

type ViewMode = "edit" | "preview" | "split"

export function MarkdownDocumentEditor({
  collaborationDocument,
  collaborationProvider,
  onTitleBlur,
  onTitleChange,
  title,
}: {
  collaborationDocument: Y.Doc
  collaborationProvider: HocuspocusProvider
  onTitleBlur?: () => void
  onTitleChange: (title: string) => void
  title: string
}) {
  const { t } = useLocale()
  const markdownText = React.useMemo(
    () => collaborationDocument.getText("markdown"),
    [collaborationDocument],
  )
  const [mode, setMode] = React.useState<ViewMode>("split")
  const [lineNumbers, setLineNumbers] = React.useState(true)
  const [view, setView] = React.useState<EditorView | null>(null)
  const undoManager = React.useMemo(() => new Y.UndoManager(markdownText), [markdownText])
  const previewSource = useMarkdownPreviewSource(markdownText)
  const [history, setHistory] = React.useState({ canRedo: false, canUndo: false })

  React.useEffect(() => {
    const update = () => {
      setHistory({
        canRedo: undoManager.redoStack.length > 0,
        canUndo: undoManager.undoStack.length > 0,
      })
    }
    undoManager.on("stack-item-added", update)
    undoManager.on("stack-item-popped", update)
    undoManager.on("stack-item-updated", update)
    return () => {
      undoManager.off("stack-item-added", update)
      undoManager.off("stack-item-popped", update)
      undoManager.off("stack-item-updated", update)
    }
  }, [undoManager])

  const editDisabled = !view || mode === "preview"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-3">
        <Tool
          disabled={editDisabled || !history.canUndo}
          icon={Undo2}
          label="撤销"
          onClick={() => {
            undoManager.undo()
            view?.focus()
          }}
        />
        <Tool
          disabled={editDisabled || !history.canRedo}
          icon={Redo2}
          label="重做"
          onClick={() => {
            undoManager.redo()
            view?.focus()
          }}
        />
        <DocumentControlSeparator />
        <Tool
          disabled={editDisabled}
          icon={Bold}
          label="粗体"
          onClick={() => view && toggleMarkdownWrap(view, "**", "粗体文本")}
        />
        <Tool
          disabled={editDisabled}
          icon={Italic}
          label="斜体"
          onClick={() => view && toggleMarkdownWrap(view, "_", "斜体文本")}
        />
        <Tool
          disabled={editDisabled}
          icon={Strikethrough}
          label="删除线"
          onClick={() => view && toggleMarkdownWrap(view, "~~", "删除线文本")}
        />
        <DocumentControlSeparator />
        <Tool
          disabled={editDisabled}
          icon={List}
          label="无序列表"
          onClick={() => view && toggleMarkdownList(view, "bullet")}
        />
        <Tool
          disabled={editDisabled}
          icon={ListOrdered}
          label="有序列表"
          onClick={() => view && toggleMarkdownList(view, "ordered")}
        />
        <Tool
          disabled={editDisabled}
          icon={ListTodo}
          label="任务列表"
          onClick={() => view && toggleMarkdownList(view, "task")}
        />
        <DocumentControlSeparator />
        <MarkdownLinkInsertMenu disabled={editDisabled} view={view} />
        <MarkdownImageInsertMenu disabled={editDisabled} view={view} />
        <Tool
          disabled={editDisabled}
          icon={Minus}
          label="插入分割线"
          onClick={() => view && insertMarkdownBlock(view, "---")}
        />
        <MarkdownTableInsertMenu
          disabled={editDisabled}
          onInsert={(rows, columns) =>
            view &&
            insertMarkdownTable(view, rows, columns, (number) =>
              t("document.table.column", { number }),
            )
          }
        />
        <DocumentControlSeparator />
        <Tool active={mode === "edit"} icon={Pencil} label="编辑" onClick={() => setMode("edit")} />
        <Tool
          active={mode === "split"}
          icon={Columns2}
          label="分屏"
          onClick={() => setMode("split")}
        />
        <Tool
          active={mode === "preview"}
          icon={Eye}
          label="预览"
          onClick={() => setMode("preview")}
        />
        <Tool
          active={lineNumbers}
          icon={ListOrdered}
          label="行号"
          onClick={() => setLineNumbers((value) => !value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div
          className={cn(
            "mx-auto grid min-h-full max-w-7xl gap-4",
            mode === "split" && "md:grid-cols-2",
          )}
        >
          <section
            className={cn(
              "flex min-w-0 flex-col border bg-background",
              mode === "preview" && "hidden",
            )}
          >
            <input
              aria-label="文档页面标题"
              className="mx-8 mt-8 mb-4 border-b bg-transparent pb-4 text-3xl font-bold outline-none"
              onBlur={onTitleBlur}
              onChange={(event) => onTitleChange(event.target.value)}
              value={title}
            />
            <div className="min-h-96 min-w-0 flex-1">
              <CodeMirror
                aria-label="Markdown 正文"
                basicSetup={{
                  foldGutter: false,
                  history: false,
                  lineNumbers,
                  searchKeymap: false,
                }}
                className="markdown-source-editor h-full"
                extensions={[
                  markdown({ base: markdownLanguage }),
                  placeholder("开始撰写 Markdown"),
                  keymap.of(yUndoManagerKeymap),
                  EditorView.lineWrapping,
                  yCollab(markdownText, collaborationProvider.awareness, { undoManager }),
                ]}
                height="100%"
                onCreateEditor={setView}
                value={markdownText.toString()}
              />
            </div>
          </section>
          <section
            className={cn(
              "min-w-0 border bg-background p-8",
              mode === "edit" && "hidden",
              mode === "split" && "hidden md:block",
            )}
          >
            <h1 className="mb-6 border-b pb-4 text-3xl font-bold break-words">
              {title || "无标题 Markdown"}
            </h1>
            <article aria-label="Markdown 预览" className="min-w-0 overflow-hidden">
              {previewSource.trim() ? (
                <MessageMarkdown content={previewSource} variant="document" />
              ) : (
                <p className="text-sm text-muted-foreground">暂无 Markdown 内容</p>
              )}
            </article>
          </section>
        </div>
      </div>
    </div>
  )
}

function MarkdownLinkInsertMenu({
  disabled,
  view,
}: {
  disabled: boolean
  view: EditorView | null
}) {
  const { t } = useLocale()
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState("")

  function applyLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!view || !url.trim()) return
    const selection = view.state.selection.main
    const selectedText = view.state.doc.sliceString(selection.from, selection.to)
    const label = selectedText || t("document.link.defaultLabel")
    const href = normalizeMarkdownLinkURL(url)
    const insert = `[${label.replaceAll("]", "\\]")}](${href})`
    view.dispatch({
      changes: { from: selection.from, insert, to: selection.to },
      selection: selectedText
        ? { anchor: selection.from + insert.length }
        : {
            anchor: selection.from + 1,
            head: selection.from + 1 + label.length,
          },
    })
    view.focus()
    setOpen(false)
  }

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setUrl("")
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={t("document.link.insert")}
          disabled={disabled}
          size="icon-sm"
          title={t("document.link.insert")}
          type="button"
          variant="ghost"
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 p-3">
        <form className="flex items-center gap-2" onSubmit={applyLink}>
          <Input
            aria-label={t("document.link.url")}
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t("document.link.urlPlaceholder")}
            value={url}
          />
          <Button disabled={!url.trim()} size="sm" type="submit">
            {t("document.link.apply")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function MarkdownImageInsertMenu({
  disabled,
  view,
}: {
  disabled: boolean
  view: EditorView | null
}) {
  const { t } = useLocale()
  const [open, setOpen] = React.useState(false)
  const [alt, setAlt] = React.useState("")
  const [url, setUrl] = React.useState("")

  function applyImage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!view || !url.trim()) return
    const selection = view.state.selection.main
    const imageAlt = alt.trim() || t("document.image.defaultAlt")
    const insert = `![${imageAlt.replaceAll("]", "\\]")}](${normalizeMarkdownImageURL(url)})`
    view.dispatch({
      changes: { from: selection.from, insert, to: selection.to },
      selection: { anchor: selection.from + insert.length },
    })
    view.focus()
    setOpen(false)
  }

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setAlt("")
          setUrl("")
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={t("document.image.insert")}
          disabled={disabled}
          size="icon-sm"
          title={t("document.image.insert")}
          type="button"
          variant="ghost"
        >
          <ImagePlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 p-3">
        <form className="space-y-2" onSubmit={applyImage}>
          <Input
            aria-label={t("document.image.url")}
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t("document.image.urlPlaceholder")}
            value={url}
          />
          <Input
            aria-label={t("document.image.alt")}
            onChange={(event) => setAlt(event.target.value)}
            placeholder={t("document.image.altPlaceholder")}
            value={alt}
          />
          <div className="flex justify-end">
            <Button disabled={!url.trim()} size="sm" type="submit">
              {t("document.image.confirm")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function toggleMarkdownWrap(view: EditorView, marker: string, placeholderText: string) {
  const selection = view.state.selection.main
  const selectedText = view.state.doc.sliceString(selection.from, selection.to)
  const markerLength = marker.length
  const markerBefore = view.state.doc.sliceString(
    Math.max(0, selection.from - markerLength),
    selection.from,
  )
  const markerAfter = view.state.doc.sliceString(selection.to, selection.to + markerLength)

  if (
    selectedText &&
    markerBefore === marker &&
    markerAfter === marker &&
    selection.from >= markerLength
  ) {
    view.dispatch({
      changes: [
        { from: selection.from - markerLength, to: selection.from },
        { from: selection.to, to: selection.to + markerLength },
      ],
      selection: {
        anchor: selection.from - markerLength,
        head: selection.to - markerLength,
      },
    })
  } else if (
    selectedText.length >= markerLength * 2 &&
    selectedText.startsWith(marker) &&
    selectedText.endsWith(marker)
  ) {
    const content = selectedText.slice(markerLength, -markerLength)
    view.dispatch({
      changes: { from: selection.from, insert: content, to: selection.to },
      selection: {
        anchor: selection.from,
        head: selection.from + content.length,
      },
    })
  } else {
    const content = selectedText || placeholderText
    view.dispatch({
      changes: {
        from: selection.from,
        insert: `${marker}${content}${marker}`,
        to: selection.to,
      },
      selection: {
        anchor: selection.from + markerLength,
        head: selection.from + markerLength + content.length,
      },
    })
  }
  view.focus()
}

function toggleMarkdownList(view: EditorView, listType: MarkdownListType) {
  const selection = view.state.selection.main
  const startLine = view.state.doc.lineAt(selection.from)
  const effectiveEnd =
    selection.to > selection.from && view.state.doc.lineAt(selection.to).from === selection.to
      ? selection.to - 1
      : selection.to
  const endLine = view.state.doc.lineAt(effectiveEnd)
  const source = view.state.doc.sliceString(startLine.from, endLine.to)
  const insert = transformMarkdownList(source, listType)

  view.dispatch({
    changes: { from: startLine.from, insert, to: endLine.to },
    selection: {
      anchor: startLine.from,
      head: startLine.from + insert.length,
    },
  })
  view.focus()
}

function insertMarkdownBlock(view: EditorView, block: string) {
  const selection = view.state.selection.main
  const before = view.state.doc.sliceString(0, selection.from)
  const after = view.state.doc.sliceString(selection.to)
  const insert = `${markdownBlockPrefix(before)}${block}${markdownBlockSuffix(after)}`
  view.dispatch({
    changes: { from: selection.from, insert, to: selection.to },
    scrollIntoView: true,
    selection: { anchor: selection.from + insert.length },
  })
  view.focus()
}

function insertMarkdownTable(
  view: EditorView,
  rows: number,
  columns: number,
  columnLabel: (number: number) => string,
) {
  const selection = view.state.selection.main
  const before = view.state.doc.sliceString(0, selection.from)
  const after = view.state.doc.sliceString(selection.to)
  const prefix = markdownBlockPrefix(before)
  const suffix = markdownBlockSuffix(after)
  const firstHeader = columnLabel(1)
  const table = createMarkdownTable(rows, columns, columnLabel)
  const insert = `${prefix}${table}${suffix}`
  const headerFrom = selection.from + prefix.length + 2

  view.dispatch({
    changes: { from: selection.from, insert, to: selection.to },
    scrollIntoView: true,
    selection: {
      anchor: headerFrom,
      head: headerFrom + firstHeader.length,
    },
  })
  view.focus()
}

function createMarkdownTable(
  rows: number,
  columns: number,
  columnLabel: (number: number) => string,
) {
  const normalizedRows = Math.max(1, rows)
  const normalizedColumns = Math.max(1, columns)
  const header = Array.from({ length: normalizedColumns }, (_, index) => columnLabel(index + 1))
  const separator = Array.from({ length: normalizedColumns }, () => "---")
  const bodyRow = Array.from({ length: normalizedColumns }, () => "")
  const lines = [markdownTableRow(header), markdownTableRow(separator)]

  for (let row = 1; row < normalizedRows; row += 1) {
    lines.push(markdownTableRow(bodyRow))
  }
  return lines.join("\n")
}

function markdownTableRow(cells: string[]) {
  return `| ${cells.join(" | ")} |`
}

function markdownBlockPrefix(before: string) {
  if (!before || before.endsWith("\n\n")) return ""
  return before.endsWith("\n") ? "\n" : "\n\n"
}

function markdownBlockSuffix(after: string) {
  if (!after || after.startsWith("\n\n")) return ""
  return after.startsWith("\n") ? "\n" : "\n\n"
}

function normalizeMarkdownLinkURL(value: string) {
  const url = value.trim()
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url) ? url : `https://${url}`
}

function normalizeMarkdownImageURL(value: string) {
  const url = value.trim()
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function useMarkdownPreviewSource(markdownText: Y.Text) {
  const [source, setSource] = React.useState(() => markdownText.toString())

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const update = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setSource(markdownText.toString()), 120)
    }
    markdownText.observe(update)
    return () => {
      markdownText.unobserve(update)
      if (timer) clearTimeout(timer)
    }
  }, [markdownText])

  return source
}

function Tool({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant={active ? "secondary" : "ghost"}
    >
      <Icon className="size-4" />
    </Button>
  )
}
