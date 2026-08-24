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
  ListChecks,
  ListOrdered,
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
  const markdownText = React.useMemo(
    () => collaborationDocument.getText("markdown"),
    [collaborationDocument],
  )
  const [mode, setMode] = React.useState<ViewMode>("split")
  const [lineNumbers, setLineNumbers] = React.useState(true)
  const [view, setView] = React.useState<EditorView | null>(null)
  const undoManager = React.useMemo(() => new Y.UndoManager(markdownText), [markdownText])
  const [source, setSource] = React.useState(() => markdownText.toString())
  const [history, setHistory] = React.useState({ canRedo: false, canUndo: false })

  React.useEffect(() => {
    const update = () => {
      setSource(markdownText.toString())
      setHistory({
        canRedo: undoManager.redoStack.length > 0,
        canUndo: undoManager.undoStack.length > 0,
      })
    }
    markdownText.observe(update)
    undoManager.on("stack-item-added", update)
    undoManager.on("stack-item-popped", update)
    return () => {
      markdownText.unobserve(update)
      undoManager.off("stack-item-added", update)
      undoManager.off("stack-item-popped", update)
    }
  }, [markdownText, undoManager])

  const editDisabled = !view || mode === "preview"
  const insert = (text: string) => {
    if (!view) return
    const selection = view.state.selection.main
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
    })
    view.focus()
  }
  const wrap = (marker: string) => {
    if (!view) return
    const selection = view.state.selection.main
    const text = view.state.doc.sliceString(selection.from, selection.to) || "文本"
    const value = `${marker}${text}${marker}`
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: value },
      selection: {
        anchor: selection.from + marker.length,
        head: selection.from + marker.length + text.length,
      },
    })
    view.focus()
  }
  const list = (prefix: string) => {
    if (!view) return
    const selection = view.state.selection.main
    const line = view.state.doc.lineAt(selection.from)
    view.dispatch({ changes: { from: line.from, to: line.to, insert: `${prefix}${line.text}` } })
    view.focus()
  }

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
        <Tool disabled={editDisabled} icon={Bold} label="粗体" onClick={() => wrap("**")} />
        <Tool disabled={editDisabled} icon={Italic} label="斜体" onClick={() => wrap("_")} />
        <Tool
          disabled={editDisabled}
          icon={Strikethrough}
          label="删除线"
          onClick={() => wrap("~~")}
        />
        <Tool disabled={editDisabled} icon={List} label="无序列表" onClick={() => list("- ")} />
        <Tool
          disabled={editDisabled}
          icon={ListOrdered}
          label="有序列表"
          onClick={() => list("1. ")}
        />
        <Tool
          disabled={editDisabled}
          icon={ListChecks}
          label="任务列表"
          onClick={() => list("- [ ] ")}
        />
        <Tool
          disabled={editDisabled}
          icon={LinkIcon}
          label="链接"
          onClick={() => insert("[链接文字](https://example.com)")}
        />
        <Tool
          disabled={editDisabled}
          icon={ImagePlus}
          label="图片"
          onClick={() => insert("![图片描述](https://example.com/image.png)")}
        />
        <Tool
          disabled={editDisabled}
          icon={Minus}
          label="分割线"
          onClick={() => insert("\n\n---\n\n")}
        />
        <Tool
          disabled={editDisabled}
          icon={List}
          label="表格"
          onClick={() => insert("\n\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n\n")}
        />
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
                basicSetup={{ lineNumbers, history: false, foldGutter: false, searchKeymap: false }}
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
              {source.trim() ? (
                <MessageMarkdown content={source} />
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
