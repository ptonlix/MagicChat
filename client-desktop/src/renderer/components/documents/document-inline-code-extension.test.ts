import { Editor } from "@tiptap/core"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { afterEach, describe, expect, it } from "vitest"

import { DocumentStarterKit } from "@/components/documents/document-inline-code-extension"

let editor: Editor | undefined

afterEach(() => editor?.destroy())

describe("DocumentStarterKit inline code", () => {
  it("excludes rich text marks but keeps text color", () => {
    editor = new Editor({
      content: '<p><strong><em><a href="https://example.com">inline</a></em></strong></p>',
      extensions: [DocumentStarterKit, TextStyle, Color],
    })
    editor.chain().setTextSelection({ from: 1, to: 7 }).toggleCode().setColor("#2563eb").run()
    expect(
      editor.state.doc
        .nodeAt(1)
        ?.marks.map((mark) => mark.type.name)
        .sort(),
    ).toEqual(["code", "textStyle"])
  })
})
