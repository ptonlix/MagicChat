import { Editor } from "@tiptap/core"
import { TableKit } from "@tiptap/extension-table"
import { TextSelection } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import StarterKit from "@tiptap/starter-kit"
import { afterEach, describe, expect, it } from "vitest"

import { PreserveTableCellTypeOnPaste } from "@/components/documents/document-table-paste-extension"

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe("PreserveTableCellTypeOnPaste", () => {
  it("表头单元格粘贴到正文时保留目标 td 类型", () => {
    editor = createEditor()
    const source = findCell(editor, "header")
    const target = findCell(editor, "body")

    const handled = copyCellAndPasteAt(editor, source.pos, target.pos)

    expect(handled).toBe(true)
    expect(findCell(editor, "header", source.pos + 1).type).toBe("tableCell")
  })

  it("正文单元格粘贴到表头时保留目标 th 类型", () => {
    editor = createEditor()
    const source = findCell(editor, "body")
    const target = findCell(editor, "header")

    const handled = copyCellAndPasteAt(editor, source.pos, target.pos)

    expect(handled).toBe(true)
    expect(findCell(editor, "body").type).toBe("tableHeader")
  })

  it("表格外粘贴不由该扩展接管", () => {
    editor = createEditor()
    const source = findCell(editor, "header")
    editor.view.dispatch(
      editor.state.tr.setSelection(new CellSelection(editor.state.doc.resolve(source.pos))),
    )
    const slice = editor.state.selection.content()
    const paragraphPosition = editor.state.doc.content.size - 1
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition)),
    )

    const handled = paste(editor, slice)

    expect(handled).toBeFalsy()
    expect(editor.getText()).toContain("outside")
  })

  it("单单元格切片粘贴到多单元格目标时继续使用表格扩展的默认映射", () => {
    editor = createEditor()
    const header = findCell(editor, "header")
    const body = findCell(editor, "body")
    editor.view.dispatch(
      editor.state.tr.setSelection(new CellSelection(editor.state.doc.resolve(header.pos))),
    )
    const slice = editor.state.selection.content()
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(editor.state.doc.resolve(body.pos), editor.state.doc.resolve(header.pos)),
      ),
    )

    const handled = paste(editor, slice)

    expect(handled).toBe(true)
    expect(tableCells(editor).map((cell) => cell.type)).toEqual(["tableHeader", "tableHeader"])
  })
})

function createEditor() {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, PreserveTableCellTypeOnPaste, TableKit],
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          content: [tableRow("tableHeader", "header"), tableRow("tableCell", "body")],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "outside" }],
        },
      ],
    },
  })
}

function copyCellAndPasteAt(currentEditor: Editor, sourcePosition: number, targetPosition: number) {
  currentEditor.view.dispatch(
    currentEditor.state.tr.setSelection(
      new CellSelection(currentEditor.state.doc.resolve(sourcePosition)),
    ),
  )
  const slice = currentEditor.state.selection.content()
  currentEditor.view.dispatch(
    currentEditor.state.tr.setSelection(
      TextSelection.create(currentEditor.state.doc, targetPosition + 2),
    ),
  )
  return paste(currentEditor, slice)
}

function paste(currentEditor: Editor, slice: ReturnType<Editor["state"]["selection"]["content"]>) {
  return currentEditor.view.someProp("handlePaste", (handlePaste) =>
    handlePaste(currentEditor.view, new Event("paste") as ClipboardEvent, slice),
  )
}

function tableRow(cellType: "tableCell" | "tableHeader", text: string) {
  return {
    type: "tableRow",
    content: [
      {
        type: cellType,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text }],
          },
        ],
      },
    ],
  }
}

function findCell(currentEditor: Editor, text: string, afterPosition = -1) {
  const cell = tableCells(currentEditor).find(
    (candidate) => candidate.text === text && candidate.pos > afterPosition,
  )
  if (!cell) throw new Error(`找不到表格单元格：${text}`)
  return cell
}

function tableCells(currentEditor: Editor) {
  const cells: Array<{ pos: number; text: string; type: string }> = []
  currentEditor.state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
      cells.push({ pos, text: node.textContent, type: node.type.name })
    }
  })
  return cells
}
