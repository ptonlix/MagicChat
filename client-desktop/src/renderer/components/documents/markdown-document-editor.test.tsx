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
  return {
    default: ({
      onCreateEditor,
      value,
    }: {
      onCreateEditor(editor: unknown): void
      value: string
    }) => {
      React.useEffect(() => onCreateEditor(mocks.editor), [onCreateEditor])
      return <div aria-label="Markdown 源码">{value}</div>
    },
  }
})
vi.mock("y-codemirror.next", () => ({
  yCollab: () => [],
  yUndoManagerKeymap: [],
}))
vi.mock("@/components/message-markdown", () => ({
  MessageMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
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
        expect.objectContaining({ changes: expect.objectContaining({ insert: "**文本**" }) }),
      ),
    )
  })
})
