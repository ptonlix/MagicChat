import * as fs from "node:fs"
import * as path from "node:path"
import * as Y from "yjs"
import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import StarterKit from "@tiptap/starter-kit"
import Collaboration from "@tiptap/extension-collaboration"
import Highlight from "@tiptap/extension-highlight"
import TaskList from "@tiptap/extension-task-list"
import { TableKit } from "@tiptap/extension-table"
import { DocumentHorizontalRule } from "@/components/documents/document-horizontal-rule-extension"
import { DocumentImage } from "@/components/documents/document-image-extension"
import { DocumentTaskItem } from "@/components/documents/document-task-item-extension"

const fixtureDirectory = path.resolve(__dirname, "../test/fixtures/web-composite-document-2e23981")
const fixturePath = path.join(fixtureDirectory, "state.yjs")
const metadataPath = path.join(fixtureDirectory, "metadata.json")

describe("固定 Web Yjs 复合文档夹具", () => {
  it("从静态二进制加载、编辑普通段落并保留所有新节点属性", () => {
    const update = new Uint8Array(fs.readFileSync(fixturePath))
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
      attributes: Record<string, string[]>
      sourceCommit: string
      markTypes: string[]
      nodeTypes: string[]
    }
    expect(metadata.sourceCommit).toBe("2e23981")
    const document = new Y.Doc()
    Y.applyUpdate(document, update)
    const editor = createFixtureEditor(document)
    editor.commands.insertContentAt(1, "已编辑")
    const json = editor.getJSON()
    const found = new Set<string>()
    const foundMarks = new Set<string>()
    editor.state.doc.descendants((node) => {
      found.add(node.type.name)
      for (const mark of node.marks) foundMarks.add(mark.type.name)
    })
    for (const type of metadata.nodeTypes) expect(found).toContain(type)
    for (const type of metadata.markTypes) expect(foundMarks).toContain(type)
    expect(JSON.stringify(json)).toContain("file-fixture-1")
    expect(JSON.stringify(json)).toContain("dotted")
    expect(JSON.stringify(json)).toContain("#fef08a")

    const image = findNode(editor, "documentImage")
    const horizontalRule = findNode(editor, "horizontalRule")
    const taskItem = findNode(editor, "taskItem")
    const table = findNode(editor, "table")
    expect(metadata.attributes.documentImage).toEqual(["fileId", "alt", "alignment", "width"])
    expect(image?.attrs).toMatchObject({
      alignment: "right",
      alt: "固定图片",
      fileId: "file-fixture-1",
      width: 65,
    })
    expect(metadata.attributes.horizontalRule).toEqual(["lineStyle", "thickness"])
    expect(horizontalRule?.attrs).toMatchObject({ lineStyle: "dotted", thickness: 5 })
    expect(table?.childCount).toBe(2)
    expect(table?.firstChild?.firstChild?.type.name).toBe("tableHeader")
    expect(metadata.attributes.taskItem).toEqual(["checked"])
    expect(taskItem?.attrs.checked).toBe(true)
    const highlightedText = findMarkAttributes(editor, "highlight")
    expect(metadata.attributes.highlight).toEqual(["color"])
    expect(highlightedText).toEqual({ color: "#fef08a" })

    const encoded = Y.encodeStateAsUpdate(document)
    const reloadedDocument = new Y.Doc()
    Y.applyUpdate(reloadedDocument, encoded)
    const reloadedEditor = createFixtureEditor(reloadedDocument)
    expect(reloadedEditor.getJSON()).toEqual(editor.getJSON())

    reloadedEditor.destroy()
    reloadedDocument.destroy()
    editor.destroy()
    document.destroy()
  })
})

function createFixtureEditor(document: Y.Doc): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      Collaboration.configure({ fragment: document.getXmlFragment("body") }),
      DocumentHorizontalRule,
      DocumentImage,
      Highlight.configure({ multicolor: true }),
      TaskList,
      DocumentTaskItem,
      TableKit,
    ],
  })
}

function findNode(editor: Editor, typeName: string): ProseMirrorNode | null {
  let result: ProseMirrorNode | null = null
  editor.state.doc.descendants((node) => {
    if (result || node.type.name !== typeName) return
    result = node
  })
  return result
}

function findMarkAttributes(editor: Editor, typeName: string) {
  let result: Record<string, unknown> | null = null
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((item) => item.type.name === typeName)
    if (mark) result = { ...mark.attrs }
  })
  return result
}
