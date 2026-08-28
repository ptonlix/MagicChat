import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn()
  return {
    dispatch,
    editor: {
      dispatch,
      focus: vi.fn(),
      state: {
        doc: {
          lineAt: () => ({ from: 0, text: "" }),
          sliceString: () => "",
        },
        selection: { main: { from: 0, to: 0 } },
      },
    },
  }
})

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: () => [],
  markdownLanguage: {},
}))
vi.mock("@codemirror/view", () => ({
  EditorView: { lineWrapping: [] },
  keymap: { of: () => [] },
  placeholder: () => [],
}))
vi.mock("@uiw/react-codemirror", async () => {
  const React = await import("react")
  function CodeMirrorMock({
    onCreateEditor,
    value,
  }: {
    onCreateEditor(editor: unknown): void
    value: string
  }) {
    React.useEffect(() => onCreateEditor(mocks.editor), [onCreateEditor])
    return <div aria-label="Markdown 源码">{value}</div>
  }
  return {
    default: CodeMirrorMock,
  }
})
vi.mock("y-codemirror.next", () => ({
  yCollab: () => [],
  yUndoManagerKeymap: [],
}))
vi.mock("@/components/message-markdown", () => ({
  MessageMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))
vi.mock("@/components/locale-provider", () => ({
  useLocale: () => ({
    locale: "en",
    t: (key: string, params?: Record<string, number>) => {
      if (key === "document.table.insert") return "Insert table"
      if (key === "document.table.selectDimensions") return "Select table dimensions"
      if (key === "document.table.dimension")
        return `${params?.rows} rows ${params?.columns} columns`
      if (key === "document.table.column") return `Column ${params?.number}`
      if (key === "document.link.insert") return "Insert link"
      if (key === "document.link.url") return "Link URL"
      if (key === "document.link.urlPlaceholder") return "Enter link URL"
      if (key === "document.link.defaultLabel") return "Link text"
      if (key === "document.link.apply") return "Apply"
      if (key === "document.image.insert") return "Insert image"
      if (key === "document.image.url") return "Image URL"
      if (key === "document.image.urlPlaceholder") return "Enter image URL"
      if (key === "document.image.alt") return "Image description"
      if (key === "document.image.altPlaceholder") return "Image description (optional)"
      if (key === "document.image.defaultAlt") return "Image"
      if (key === "document.image.confirm") return "Insert"
      return key
    },
  }),
}))

import { MarkdownDocumentEditor } from "./markdown-document-editor"

describe("MarkdownDocumentEditor", () => {
  it("以 markdown 共享文本驱动预览，格式工具只操作编辑器文本", async () => {
    const user = userEvent.setup()
    const collaborationDocument = new Y.Doc()
    const markdown = collaborationDocument.getText("markdown")
    markdown.insert(0, "初始内容")

    render(
      <MarkdownDocumentEditor
        collaborationDocument={collaborationDocument}
        collaborationProvider={{ awareness: {} } as never}
        onTitleChange={vi.fn()}
        title="协作说明"
      />,
    )

    const preview = screen.getByLabelText("Markdown 预览")
    expect(preview).toHaveTextContent("初始内容")
    act(() => markdown.insert(0, "# "))
    await waitFor(() => expect(preview).toHaveTextContent("# 初始内容"))

    await user.click(screen.getByRole("button", { name: "粗体" }))
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ changes: expect.objectContaining({ insert: "**粗体文本**" }) }),
      ),
    )
  })

  it("uses the active locale for inserted table headers", async () => {
    const user = userEvent.setup()
    const collaborationDocument = new Y.Doc()

    render(
      <MarkdownDocumentEditor
        collaborationDocument={collaborationDocument}
        collaborationProvider={{ awareness: {} } as never}
        onTitleChange={vi.fn()}
        title="Document"
      />,
    )

    await user.click(screen.getByRole("button", { name: "Insert table" }))
    await user.click(screen.getByRole("gridcell", { name: "2 rows 3 columns" }))

    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          insert: "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |",
        }),
      }),
    )
  })

  it("uses English controls and defaults for inserted links and images", async () => {
    const user = userEvent.setup()
    const collaborationDocument = new Y.Doc()

    render(
      <MarkdownDocumentEditor
        collaborationDocument={collaborationDocument}
        collaborationProvider={{ awareness: {} } as never}
        onTitleChange={vi.fn()}
        title="Document"
      />,
    )

    await user.click(screen.getByRole("button", { name: "Insert link" }))
    expect(screen.getByPlaceholderText("Enter link URL")).toBeVisible()
    await user.type(screen.getByRole("textbox", { name: "Link URL" }), "example.com")
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ insert: "[Link text](https://example.com)" }),
      }),
    )

    await user.click(screen.getByRole("button", { name: "Insert image" }))
    expect(screen.getByPlaceholderText("Enter image URL")).toBeVisible()
    expect(screen.getByPlaceholderText("Image description (optional)")).toBeVisible()
    await user.type(screen.getByRole("textbox", { name: "Image URL" }), "example.com/image.png")
    await user.click(screen.getByRole("button", { name: "Insert" }))
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ insert: "![Image](https://example.com/image.png)" }),
      }),
    )
  })
})
