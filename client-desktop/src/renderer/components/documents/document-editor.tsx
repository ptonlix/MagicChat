import * as React from "react"
import Collaboration from "@tiptap/extension-collaboration"
import { DragHandle, type DragHandleProps } from "@tiptap/extension-drag-handle-react"
import Placeholder from "@tiptap/extension-placeholder"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import TextAlign from "@tiptap/extension-text-align"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import type * as Y from "yjs"
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Palette,
  Pilcrow,
  Quote,
  Redo2,
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

import "./document-editor.css"

export function DocumentEditor({
  collaborationDocument,
  onTitleBlur,
  onTitleChange,
  readOnly = false,
  title,
}: {
  collaborationDocument: Y.Doc
  onTitleBlur(): void
  onTitleChange(title: string): void
  readOnly?: boolean
  title: string
}) {
  const editor = useEditor({
    editable: !readOnly,
    editorProps: {
      attributes: { "aria-label": "文档正文", class: "document-editor-content" },
      handleClick: (_view, _pos, event) => {
        if ((event.target as Element | null)?.closest("a")) event.preventDefault()
        return false
      },
    },
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
        undoRedo: false,
      }),
      Collaboration.configure({ fragment: collaborationDocument.getXmlFragment("body") }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "开始撰写文档..." }),
    ],
    shouldRerenderOnTransaction: true,
  })

  React.useEffect(() => () => editor?.destroy(), [editor])
  if (!editor) return <div className="p-8 text-sm text-muted-foreground">正在初始化编辑器</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DocumentToolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="document-editor mx-auto min-h-full max-w-4xl border bg-background px-6 py-10 shadow-sm sm:px-14 sm:py-14">
          <input
            aria-label="文档页面标题"
            className="mb-8 w-full border-b bg-transparent pb-5 text-3xl font-bold outline-none placeholder:text-muted-foreground/60 sm:text-4xl"
            disabled={readOnly}
            onBlur={onTitleBlur}
            onChange={(event) => onTitleChange(limitDocumentTitle(event.target.value))}
            placeholder="无标题文档"
            value={title}
          />
          <EditorContent editor={editor} />
          {!readOnly && <DocumentBlockHandle editor={editor} />}
        </div>
      </div>
    </div>
  )
}

function DocumentToolbar({ editor }: { editor: Editor }) {
  const align =
    (editor.getAttributes("paragraph").textAlign as string | undefined) ??
    (editor.getAttributes("heading").textAlign as string | undefined) ??
    "left"
  const controls = [
    [
      "撤销",
      Undo2,
      () => editor.chain().focus().undo().run(),
      editor.can().chain().focus().undo().run(),
    ],
    [
      "重做",
      Redo2,
      () => editor.chain().focus().redo().run(),
      editor.can().chain().focus().redo().run(),
    ],
    ["粗体", Bold, () => editor.chain().focus().toggleBold().run(), true, editor.isActive("bold")],
    [
      "斜体",
      Italic,
      () => editor.chain().focus().toggleItalic().run(),
      true,
      editor.isActive("italic"),
    ],
    [
      "下划线",
      Underline,
      () => editor.chain().focus().toggleUnderline().run(),
      true,
      editor.isActive("underline"),
    ],
    [
      "删除线",
      Strikethrough,
      () => editor.chain().focus().toggleStrike().run(),
      true,
      editor.isActive("strike"),
    ],
    [
      "无序列表",
      List,
      () => editor.chain().focus().toggleBulletList().run(),
      true,
      editor.isActive("bulletList"),
    ],
    [
      "有序列表",
      ListOrdered,
      () => editor.chain().focus().toggleOrderedList().run(),
      true,
      editor.isActive("orderedList"),
    ],
    [
      "待办列表",
      ListTodo,
      () => editor.chain().focus().toggleTaskList().run(),
      true,
      editor.isActive("taskList"),
    ],
  ] as const
  return (
    <div
      aria-label="文档格式工具栏"
      className="no-drag flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-3"
      role="toolbar"
    >
      {controls.map(([label, Icon, action, enabled, active]) => (
        <ToolbarButton
          active={active}
          disabled={!enabled}
          key={label}
          label={label}
          onClick={action}
        >
          <Icon />
        </ToolbarButton>
      ))}
      <TextColorMenu editor={editor} />
      {(["left", "center", "right", "justify"] as const).map((value) => {
        const Icon =
          value === "left"
            ? AlignLeft
            : value === "center"
              ? AlignCenter
              : value === "right"
                ? AlignRight
                : AlignJustify
        const label =
          value === "left"
            ? "左对齐"
            : value === "center"
              ? "居中对齐"
              : value === "right"
                ? "右对齐"
                : "两端对齐"
        return (
          <ToolbarButton
            active={align === value}
            key={value}
            label={label}
            onClick={() => editor.chain().focus().setTextAlign(value).run()}
          >
            <Icon />
          </ToolbarButton>
        )
      })}
      <BlockFormatMenu editor={editor} />
      <LinkMenu editor={editor} />
    </div>
  )
}

function ToolbarButton({
  active,
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
          aria-pressed={active}
          className={cn(active && "bg-accent")}
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

function BlockFormatMenu({ editor }: { editor: Editor }) {
  const formats = [
    ["正文", Pilcrow, () => editor.chain().focus().setParagraph().run()],
    ["一级标题", Heading1, () => editor.chain().focus().setHeading({ level: 1 }).run()],
    ["二级标题", Heading2, () => editor.chain().focus().setHeading({ level: 2 }).run()],
    ["三级标题", Heading3, () => editor.chain().focus().setHeading({ level: 3 }).run()],
    ["引用", Quote, () => editor.chain().focus().toggleBlockquote().run()],
    ["代码块", Code, () => editor.chain().focus().toggleCodeBlock().run()],
  ] as const
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="块格式" size="icon-sm" variant="ghost">
          <Pilcrow />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map(([label, Icon, action]) => (
          <DropdownMenuItem
            disabled={!editor.can().chain().focus().run()}
            key={label}
            onSelect={action}
          >
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TextColorMenu({ editor }: { editor: Editor }) {
  const colors = ["#111827", "#dc2626", "#d97706", "#16a34a", "#2563eb", "#7c3aed"]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label="文字颜色" size="icon-sm" variant="ghost">
          <Palette />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto gap-2 p-2">
        {colors.map((color) => (
          <button
            aria-label={`文字颜色 ${color}`}
            className="size-6 rounded-sm border"
            key={color}
            onClick={() => editor.chain().focus().setColor(color).run()}
            style={{ backgroundColor: color }}
            type="button"
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

function LinkMenu({ editor }: { editor: Editor }) {
  const [url, setUrl] = React.useState("")
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label="链接" size="icon-sm" variant="ghost">
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <Input
          aria-label="链接地址"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com"
          value={url}
        />
        <div className="flex justify-end gap-2">
          <Button
            aria-label="移除链接"
            onClick={() => editor.chain().focus().unsetLink().run()}
            size="icon-sm"
            variant="outline"
          >
            <Unlink />
          </Button>
          <Button
            disabled={!isHttpUrl(url)}
            onClick={() =>
              editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run()
            }
            size="sm"
          >
            应用
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DocumentBlockHandle({ editor }: { editor: Editor }) {
  const [active, setActive] = React.useState<{ nodeSize: number; pos: number } | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const handleNodeChange = React.useCallback<NonNullable<DragHandleProps["onNodeChange"]>>(
    ({ node, pos }) => {
      const next = node ? { nodeSize: node.nodeSize, pos } : null
      setActive((current) => {
        if (!current && !next) return current
        if (current && next && current.nodeSize === next.nodeSize && current.pos === next.pos) {
          return current
        }
        return next
      })
    },
    [],
  )
  return (
    <DragHandle
      className="document-block-handle"
      editor={editor}
      nested
      onNodeChange={handleNodeChange}
    >
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open)
          editor.commands.setMeta("lockDragHandle", open)
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="块操作"
            className="cursor-grab bg-background shadow-xs"
            size="icon-xs"
            variant="outline"
          >
            <GripVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="left">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Pilcrow />
              转换为
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
                <Pilcrow />
                正文
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => editor.chain().focus().setHeading({ level: 1 }).run()}
              >
                <Heading1 />
                一级标题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleBlockquote().run()}>
                <Quote />
                引用
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!active} onSelect={() => duplicateBlock(editor, active)}>
            <Copy />
            复制块
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!active}
            onSelect={() => deleteBlock(editor, active)}
            variant="destructive"
          >
            <Trash2 />
            删除块
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DragHandle>
  )
}

function duplicateBlock(editor: Editor, active: { nodeSize: number; pos: number } | null) {
  if (!active) return
  const node = editor.state.doc.nodeAt(active.pos)
  if (!node) return
  editor.view.dispatch(
    editor.state.tr.insert(active.pos + active.nodeSize, node.copy(node.content)).scrollIntoView(),
  )
}

function deleteBlock(editor: Editor, active: { pos: number } | null) {
  if (active) editor.chain().focus().setNodeSelection(active.pos).deleteSelection().run()
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value.trim()).protocol
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}
