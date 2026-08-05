import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { TableKit } from "@tiptap/extension-table"
import Highlight from "@tiptap/extension-highlight"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import TaskList from "@tiptap/extension-task-list"
import { describe, expect, it } from "vitest"
import { DocumentHorizontalRule } from "./document-horizontal-rule-extension"
import { DocumentImage, isLoadableDocumentExternalImage } from "./document-image-extension"
import { DocumentTaskItem } from "./document-task-item-extension"
import { isDocumentBlockTransformable } from "./document-block-utils"

describe("Desktop 文档 Schema", () => {
  it("解析并再次序列化 Web 复合节点时保留名称和属性", () => {
    const editor = new Editor({
      content: `<p>基础段落</p><figure data-document-image data-file-id="file-1" data-width="65" data-alignment="right" data-alt="图片"><span>文档图片</span></figure><hr data-thickness="4" data-line-style="dashed"><table><tbody><tr><th><p>表头</p></th></tr></tbody></table><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>完成</p></li></ul><p><mark data-color="#fef08a" style="background-color:#fef08a">高亮</mark></p>`,
      extensions: [
        StarterKit.configure({ horizontalRule: false }),
        DocumentHorizontalRule,
        DocumentImage,
        TableKit,
        Highlight.configure({ multicolor: true }),
        TaskList,
        DocumentTaskItem,
      ],
    })
    const json = editor.getJSON()
    expect(JSON.stringify(json)).toContain('"type":"documentImage"')
    expect(JSON.stringify(json)).toContain('"lineStyle":"dashed"')
    expect(JSON.stringify(json)).toContain('"type":"table"')
    expect(JSON.stringify(json)).toContain('"type":"taskItem"')
    expect(JSON.stringify(json)).toContain('"color":"#fef08a"')
    editor.commands.insertContentAt(1, "已编辑")
    expect(editor.getHTML()).toContain('data-file-id="file-1"')
    expect(editor.getHTML()).toContain('data-line-style="dashed"')
    editor.destroy()
  })

  it("只加载 HTTPS 外部图片但保留 HTTP 属性", () => {
    expect(isLoadableDocumentExternalImage("https://example.com/image.png")).toBe(true)
    expect(isLoadableDocumentExternalImage("http://example.com/image.png")).toBe(false)
  })

  it("兼容旧文档基础节点并保留既有四向对齐属性", () => {
    const editor = new Editor({
      content:
        '<h2>标题</h2><p style="text-align:justify"><a href="https://example.com"><span style="color:#123456">链接</span></a></p><ul><li><p>列表</p></li></ul>',
      extensions: [StarterKit, DocumentHorizontalRule, DocumentImage, TableKit],
    })
    const html = editor.getHTML()
    expect(html).toContain("<h2>标题</h2>")
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain("<ul>")
    expect(editor.getJSON().content?.[1]?.attrs?.textAlign).toBeUndefined()
    editor.commands.insertContentAt(1, "编辑")
    expect(editor.getHTML()).toContain("<ul>")
    editor.destroy()
  })

  it("复制、删除和转换普通块时不把 atom 或 table 节点改成段落", () => {
    const editor = new Editor({
      content:
        '<p>普通块</p><figure data-document-image data-file-id="file-1"><span>文档图片</span></figure><table><tbody><tr><td><p>单元格</p></td></tr></tbody></table>',
      extensions: [StarterKit, DocumentHorizontalRule, DocumentImage, TableKit],
    })
    editor.commands.setTextSelection(1)
    editor.commands.toggleHeading({ level: 2 })
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"documentImage"')
    expect(json).toContain('"type":"table"')
    editor.commands.deleteRange({ from: 1, to: 2 })
    const remaining = JSON.stringify(editor.getJSON())
    expect(remaining).toContain('"type":"documentImage"')
    expect(remaining).toContain('"type":"table"')
    editor.destroy()
  })

  it("禁止块菜单转换图片和表格节点", () => {
    const editor = new Editor({
      content:
        '<p>普通块</p><figure data-document-image data-file-id="file-1"><span>文档图片</span></figure><table><tbody><tr><td><p>单元格</p></td></tr></tbody></table>',
      extensions: [StarterKit, DocumentHorizontalRule, DocumentImage, TableKit],
    })
    let paragraph: ProseMirrorNode | null = null
    let image: ProseMirrorNode | null = null
    let table: ProseMirrorNode | null = null
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph") paragraph = node
      if (node.type.name === "documentImage") image = node
      if (node.type.name === "table") table = node
    })

    expect(isDocumentBlockTransformable(paragraph)).toBe(true)
    expect(isDocumentBlockTransformable(image)).toBe(false)
    expect(isDocumentBlockTransformable(table)).toBe(false)
    editor.destroy()
  })
})
