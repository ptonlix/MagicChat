import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { describe, expect, it } from "vitest"

import { mapActiveDocumentBlock } from "./document-block-utils"

describe("文档块位置映射", () => {
  it("远端插入前置块后映射活动块位置", () => {
    const editor = createEditor()
    const first = editor.state.doc.firstChild
    if (!first) throw new Error("测试文档缺少首个段落")
    const second = editor.state.doc.nodeAt(first.nodeSize)
    if (!second) throw new Error("测试文档缺少第二个段落")

    const activeBlock = { nodeSize: second.nodeSize, pos: first.nodeSize }
    const inserted = editor.schema.nodes.paragraph.create(null, editor.schema.text("前置块"))
    const mapped = mapActiveDocumentBlock(activeBlock, editor.state.tr.insert(0, inserted))

    expect(mapped).toEqual({
      nodeSize: second.nodeSize,
      pos: first.nodeSize + inserted.nodeSize,
    })
    editor.destroy()
  })

  it("活动块被删除后使位置失效", () => {
    const editor = createEditor()
    const first = editor.state.doc.firstChild
    if (!first) throw new Error("测试文档缺少首个段落")
    const second = editor.state.doc.nodeAt(first.nodeSize)
    if (!second) throw new Error("测试文档缺少第二个段落")

    const activeBlock = { nodeSize: second.nodeSize, pos: first.nodeSize }
    const mapped = mapActiveDocumentBlock(
      activeBlock,
      editor.state.tr.delete(activeBlock.pos, activeBlock.pos + activeBlock.nodeSize),
    )

    expect(mapped).toBeNull()
    editor.destroy()
  })
})

function createEditor() {
  return new Editor({
    content: "<p>首个段落</p><p>活动段落</p>",
    extensions: [StarterKit],
  })
}
