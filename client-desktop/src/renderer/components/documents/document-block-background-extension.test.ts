import { Editor } from "@tiptap/core"
import Collaboration from "@tiptap/extension-collaboration"
import { afterEach, describe, expect, it } from "vitest"
import * as Y from "yjs"

import { DocumentBlockBackground } from "@/components/documents/document-block-background-extension"
import { DocumentStarterKit } from "@/components/documents/document-inline-code-extension"

const color = "oklch(93.6% 0.032 17.717)"

let editor: Editor | undefined

afterEach(() => editor?.destroy())

describe("DocumentBlockBackground", () => {
  it("round-trips an allowed color through JSON and HTML", () => {
    editor = new Editor({
      content: {
        content: [
          {
            attrs: { blockBackgroundColor: color },
            content: [{ text: "正文", type: "text" }],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      extensions: [
        DocumentStarterKit,
        DocumentBlockBackground.configure({ allowedColors: [color] }),
      ],
    })
    expect(editor.getJSON().content?.[0]?.attrs?.blockBackgroundColor).toBe(color)
    expect(editor.getHTML()).toContain(`data-block-background-color="${color}"`)
  })

  it("preserves valid attributes in a collaborative Yjs document and ignores invalid values", () => {
    const document = new Y.Doc()
    editor = new Editor({
      extensions: [
        DocumentStarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ fragment: document.getXmlFragment("body") }),
        DocumentBlockBackground.configure({ allowedColors: [color] }),
      ],
    })
    const paragraph = editor.state.doc.nodeAt(0)
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...paragraph?.attrs,
        blockBackgroundColor: color,
      }),
    )
    expect(editor.state.doc.nodeAt(0)?.attrs.blockBackgroundColor).toBe(color)
    editor.commands.setContent('<p data-block-background-color="red;position:fixed">safe</p>')
    expect(editor.state.doc.firstChild?.attrs.blockBackgroundColor).toBeNull()
    document.destroy()
  })
})
