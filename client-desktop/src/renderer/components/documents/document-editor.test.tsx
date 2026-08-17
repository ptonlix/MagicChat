import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Editor } from "@tiptap/core"
import Collaboration from "@tiptap/extension-collaboration"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import { TableKit } from "@tiptap/extension-table"
import StarterKit from "@tiptap/starter-kit"
import { StrictMode } from "react"
import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import { TooltipProvider } from "@/components/ui/tooltip"
import { DocumentEditor } from "./document-editor"
import { transformDocumentBlock } from "./document-block-utils"
import { DocumentHorizontalRule } from "./document-horizontal-rule-extension"

describe("DocumentEditor", () => {
  it("初始化标题、正文和 Placeholder，并允许键盘焦点进入正文", async () => {
    const document = new Y.Doc()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="一份很长但必须完整显示的文档标题"
      />,
    )

    const title = screen.getByRole("textbox", { name: "文档页面标题" })
    expect(title).toHaveValue("一份很长但必须完整显示的文档标题")
    expect(title).not.toHaveAttribute("maxlength")
    const body = await screen.findByLabelText("文档正文")
    expect(body).toHaveAttribute("contenteditable", "true")
    expect(body.querySelector("p")).toHaveAttribute("data-placeholder", "开始撰写文档...")
    body.focus()
    expect(body).toHaveFocus()
  })

  it("只读状态禁用标题和正文编辑", async () => {
    const document = new Y.Doc()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        readOnly
        title="只读文档"
      />,
    )

    expect(screen.getByRole("textbox", { name: "文档页面标题" })).toBeDisabled()
    expect(await screen.findByLabelText("文档正文")).toHaveAttribute("contenteditable", "false")
    expect(screen.queryByRole("toolbar", { name: "文档格式工具栏" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "粗体" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "插入分割线" })).not.toBeInTheDocument()
  })

  it("待办项使用与 Web 一致的同行布局并把勾选状态同步到 Yjs", async () => {
    const user = userEvent.setup()
    const document = createTaskDocument()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="待办文档"
      />,
    )

    const parentText = await screen.findByText("父事项")
    const parentItem = parentText.closest("li.document-task-item")
    expect(parentItem).not.toBeNull()
    expect(parentItem?.children[0]).toHaveClass("document-task-item__checkbox")
    expect(parentItem?.children[1]).toHaveClass("document-task-item__content")
    expect(screen.getAllByRole("checkbox")).toHaveLength(2)

    const parentCheckbox = screen.getByRole("checkbox", { name: "标记为已完成" })
    await user.click(parentCheckbox)
    await waitFor(() => expect(readTaskCheckedStates(document)).toEqual([true, true]))
    expect(parentCheckbox).toHaveAccessibleName("标记为未完成")
    expect(parentCheckbox).toBeChecked()
  })

  it("只读文档中的待办复选框不可修改共享状态", async () => {
    const document = createTaskDocument()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        readOnly
        title="只读待办文档"
      />,
    )

    const checkboxes = await screen.findAllByRole("checkbox")
    for (const checkbox of checkboxes) expect(checkbox).toBeDisabled()
    expect(screen.getByRole("button", { name: "设置分割线" })).toBeDisabled()
    fireEvent.click(checkboxes[0])
    expect(readTaskCheckedStates(document)).toEqual([false, true])
    expect(readHorizontalRuleAttributes(document)).toEqual({
      lineStyle: "dashed",
      thickness: 2,
    })
  })

  it("StrictMode 和文档切换期间不会访问已销毁的编辑器视图", async () => {
    const firstDocument = new Y.Doc()
    const secondDocument = new Y.Doc()
    const view = renderEditor(
      <StrictMode>
        <DocumentEditor
          collaborationDocument={firstDocument}
          onTitleBlur={() => undefined}
          onTitleChange={() => undefined}
          title="第一份文档"
        />
      </StrictMode>,
    )

    await screen.findByLabelText("文档正文")
    expect(() =>
      view.rerender(
        <TooltipProvider>
          <StrictMode>
            <DocumentEditor
              collaborationDocument={secondDocument}
              onTitleBlur={() => undefined}
              onTitleChange={() => undefined}
              title="第二份文档"
            />
          </StrictMode>
        </TooltipProvider>,
      ),
    ).not.toThrow()

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "文档页面标题" })).toHaveValue("第二份文档"),
    )
  })

  it("转发标题输入和失焦，并在卸载时解除 Y.Doc 监听", async () => {
    const document = new Y.Doc()
    const onTitleBlur = vi.fn()
    const onTitleChange = vi.fn()
    const before = observerCount(document)
    const view = renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={onTitleBlur}
        onTitleChange={onTitleChange}
        title="标题"
      />,
    )
    const title = screen.getByRole("textbox", { name: "文档页面标题" })
    fireEvent.change(title, { target: { value: "新标题" } })
    fireEvent.blur(title)
    expect(onTitleChange).toHaveBeenCalledWith("新标题")
    expect(onTitleBlur).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(observerCount(document)).toBeGreaterThan(before))
    view.unmount()
    await waitFor(() => expect(observerCount(document)).toBe(before))
  })

  it("按 Unicode 字符限制标题输入，不会把 emoji 按两个字符计算", () => {
    const onTitleChange = vi.fn()
    renderEditor(
      <DocumentEditor
        collaborationDocument={new Y.Doc()}
        onTitleBlur={() => undefined}
        onTitleChange={onTitleChange}
        title=""
      />,
    )
    fireEvent.change(screen.getByRole("textbox", { name: "文档页面标题" }), {
      target: { value: `${"😀".repeat(500)}尾` },
    })
    expect(onTitleChange).toHaveBeenCalledWith("😀".repeat(500))
  })

  it("提供 Web 对齐的工具栏状态、颜色菜单、表格网格和对齐菜单", async () => {
    const user = userEvent.setup()
    renderEditor(
      <DocumentEditor
        collaborationDocument={new Y.Doc()}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="工具栏"
      />,
    )

    expect(screen.getByRole("button", { name: "格式刷" })).toBeVisible()
    expect(screen.getByRole("button", { name: "文字背景色" })).toBeVisible()
    expect(screen.getByRole("button", { name: "文本对齐：左对齐" })).toBeVisible()
    const toolbar = screen.getByRole("toolbar", { name: "文档格式工具栏" })
    expect(toolbar).toHaveClass("document-toolbar", "no-drag")
    expect(toolbar.firstElementChild).toHaveClass("document-toolbar__content")
    expect(screen.getByTestId("document-workspace-canvas")).toHaveClass("document-workspace-canvas")

    await user.click(screen.getByRole("button", { name: "字体颜色" }))
    const resetColor = await screen.findByRole("menuitem", { name: "默认颜色" })
    expect(resetColor).toBeVisible()
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThanOrEqual(51)
    await user.click(resetColor)

    await user.click(screen.getByRole("button", { name: "插入表格" }))
    const grid = await screen.findByRole("grid", { name: "选择表格行列数量" })
    expect(grid).toBeVisible()
    const cell = screen.getByRole("gridcell", { name: "3 行 3 列" })
    expect(cell).toHaveAttribute("aria-pressed", "true")
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "4 行 5 列" }))
    expect(screen.getByText("4 × 5")).toBeVisible()
  })

  it("为表格单元格提供行和列操作菜单", async () => {
    const user = userEvent.setup()
    const document = new Y.Doc()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="表格操作"
      />,
    )

    await user.click(screen.getByRole("button", { name: "插入表格" }))
    await user.click(screen.getByRole("gridcell", { name: "2 行 2 列" }))

    const getTableCell = () => {
      const nextCell = screen.getByLabelText("文档正文").querySelector<HTMLTableCellElement>("td")
      if (!nextCell) throw new Error("表格单元格尚未渲染")
      return nextCell
    }
    const openTableMenu = async (name: "行操作" | "列操作") => {
      fireEvent.mouseMove(getTableCell())
      await user.click(await screen.findByRole("button", { name }))
    }

    await waitFor(() => expect(getTableCell()).toBeInTheDocument())
    await openTableMenu("行操作")
    expect(await screen.findByRole("menuitem", { name: "在上方插入行" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "在下方插入行" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "删除当前行" })).toBeVisible()
    await user.click(screen.getByRole("menuitem", { name: "在上方插入行" }))
    await waitFor(() => expect(readTableDimensions(document)).toEqual({ columns: 2, rows: 3 }))

    await openTableMenu("行操作")
    await user.click(screen.getByRole("menuitem", { name: "在下方插入行" }))
    await waitFor(() => expect(readTableDimensions(document)).toEqual({ columns: 2, rows: 4 }))

    await openTableMenu("行操作")
    await user.click(screen.getByRole("menuitem", { name: "删除当前行" }))
    await waitFor(() => expect(readTableDimensions(document)).toEqual({ columns: 2, rows: 3 }))

    await openTableMenu("列操作")
    await user.click(await screen.findByRole("menuitem", { name: "在左侧插入列" }))
    await waitFor(() => expect(readTableDimensions(document)).toEqual({ columns: 3, rows: 3 }))

    await openTableMenu("列操作")
    await user.click(await screen.findByRole("menuitem", { name: "在右侧插入列" }))
    await waitFor(() => expect(readTableDimensions(document)).toEqual({ columns: 4, rows: 3 }))

    await openTableMenu("列操作")
    await user.click(await screen.findByRole("menuitem", { name: "删除当前列" }))
    await waitFor(() => expect(readTableDimensions(document)).toEqual({ columns: 3, rows: 3 }))
  })

  it("编辑器事务只刷新工具栏订阅，不依赖编辑器根组件重渲染", async () => {
    renderEditor(
      <DocumentEditor
        collaborationDocument={new Y.Doc()}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="事务状态"
      />,
    )

    const body = await screen.findByLabelText("文档正文")
    body.focus()
    fireEvent.click(screen.getByRole("button", { name: "粗体" }))

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "粗体" })).toHaveAttribute("aria-pressed", "true"),
    )
  })

  it("工具栏直接插入默认分割线，并通过节点浮层调整样式", async () => {
    const user = userEvent.setup()
    const document = new Y.Doc()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="默认分割线"
      />,
    )

    await user.click(screen.getByRole("button", { name: "插入分割线" }))
    await waitFor(() =>
      expect(readHorizontalRuleAttributes(document)).toEqual({
        lineStyle: "solid",
        thickness: 1,
      }),
    )

    const ruleButton = await screen.findByRole("button", { name: "设置分割线" })
    await user.click(ruleButton)
    await user.click(screen.getByRole("button", { name: "分割线样式" }))
    await user.click(await screen.findByRole("menuitem", { name: "双线分割线" }))
    await waitFor(() =>
      expect(readHorizontalRuleAttributes(document)).toEqual({
        lineStyle: "double",
        thickness: 3,
      }),
    )
  })

  it("分割线插入后可调整粗细和样式并同步到 Yjs", async () => {
    const user = userEvent.setup()
    const document = createTaskDocument()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="分割线文档"
      />,
    )

    const ruleButton = await screen.findByRole("button", { name: "设置分割线" })
    expect(ruleButton.querySelector("hr")).toBeNull()
    expect(ruleButton.querySelector(".document-horizontal-rule__line")).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    await user.click(ruleButton)
    await user.click(screen.getByRole("button", { name: "分割线粗细" }))
    await user.click(await screen.findByRole("menuitem", { name: "4px 分割线" }))
    await waitFor(() =>
      expect(readHorizontalRuleAttributes(document)).toEqual({
        lineStyle: "dashed",
        thickness: 4,
      }),
    )

    await user.click(screen.getByRole("button", { name: "分割线样式" }))
    await user.click(await screen.findByRole("menuitem", { name: "双线分割线" }))
    await waitFor(() =>
      expect(readHorizontalRuleAttributes(document)).toEqual({
        lineStyle: "double",
        thickness: 4,
      }),
    )
  })

  it("格式刷支持持续激活、Escape 取消和清除格式取消状态", async () => {
    renderEditor(
      <DocumentEditor
        collaborationDocument={new Y.Doc()}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="格式刷"
      />,
    )

    const painter = screen.getByRole("button", { name: "格式刷" })
    fireEvent.click(painter)
    expect(painter).toHaveAttribute("aria-pressed", "true")
    fireEvent.keyDown(await screen.findByLabelText("文档正文"), { key: "Escape" })
    expect(painter).not.toHaveAttribute("aria-pressed", "true")

    fireEvent.click(painter)
    fireEvent.click(screen.getByRole("button", { name: "清除格式" }))
    expect(painter).not.toHaveAttribute("aria-pressed", "true")
  })

  it("链接菜单回填输入框并在应用后关闭", async () => {
    renderEditor(
      <DocumentEditor
        collaborationDocument={new Y.Doc()}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="链接"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "链接" }))
    const input = await screen.findByRole("textbox", { name: "链接地址" })
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: "example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "应用" }))
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "链接地址" })).toBeNull())
  })

  it("块转换在同一事务中清理嵌套容器并应用目标格式", () => {
    const editor = new Editor({
      content: "<ul><li><p>父项</p><ul><li><p>子项</p></li></ul></li></ul>",
      extensions: [StarterKit],
    })
    const block = editor.state.doc.firstChild
    if (!block) throw new Error("测试文档缺少列表块")
    const listItem = block.firstChild
    if (!listItem) throw new Error("测试文档缺少列表项")
    const transactions: number[] = []
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) transactions.push(transaction.steps.length)
    })

    transformDocumentBlock(editor, { nodeSize: listItem.nodeSize, pos: 1 }, "heading-2")
    expect(transactions).toHaveLength(1)
    expect(editor.getHTML()).toContain("<h2>父项</h2>")
    expect(editor.getHTML()).not.toContain("<li><p>父项</p>")
    editor.destroy()
  })
})

function renderEditor(element: ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>)
}

function observerCount(document: Y.Doc): number {
  const observers = (
    document as unknown as { _observers: Map<string, Set<(...args: unknown[]) => void>> }
  )._observers
  return [...observers.values()].reduce((total, listeners) => total + listeners.size, 0)
}

function createTaskDocument(): Y.Doc {
  const document = new Y.Doc()
  const editor = createTaskStateEditor(document)
  editor.commands.setContent({
    type: "doc",
    content: [
      {
        type: "horizontalRule",
        attrs: { lineStyle: "dashed", thickness: 2 },
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "父事项" }] },
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: { checked: true },
                    content: [{ type: "paragraph", content: [{ type: "text", text: "子事项" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
  editor.destroy()
  return document
}

function readTaskCheckedStates(document: Y.Doc): boolean[] {
  const editor = createTaskStateEditor(document)
  const checkedStates: boolean[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === "taskItem") checkedStates.push(node.attrs.checked === true)
  })
  editor.destroy()
  return checkedStates
}

function readHorizontalRuleAttributes(document: Y.Doc): {
  lineStyle: string
  thickness: number
} | null {
  const editor = createTaskStateEditor(document)
  let attributes: { lineStyle: string; thickness: number } | null = null
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "horizontalRule") return
    attributes = {
      lineStyle: String(node.attrs.lineStyle),
      thickness: Number(node.attrs.thickness),
    }
  })
  editor.destroy()
  return attributes
}

function readTableDimensions(document: Y.Doc): { columns: number; rows: number } | null {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ fragment: document.getXmlFragment("body") }),
      TableKit.configure({ table: { resizable: true } }),
    ],
  })
  let dimensions: { columns: number; rows: number } | null = null
  editor.state.doc.descendants((node) => {
    if (dimensions || node.type.name !== "table") return
    dimensions = {
      columns: node.firstChild?.childCount ?? 0,
      rows: node.childCount,
    }
  })
  editor.destroy()
  return dimensions
}

function createTaskStateEditor(document: Y.Doc): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ horizontalRule: false, undoRedo: false }),
      Collaboration.configure({ fragment: document.getXmlFragment("body") }),
      DocumentHorizontalRule,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
  })
}
