import * as fs from "node:fs"
import * as path from "node:path"
import * as Y from "yjs"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Collaboration from "@tiptap/extension-collaboration"
import Highlight from "@tiptap/extension-highlight"
import TaskList from "@tiptap/extension-task-list"
import { TableKit } from "@tiptap/extension-table"
import { describe, expect, it } from "vitest"
import { DocumentHorizontalRule } from "../../src/renderer/components/documents/document-horizontal-rule-extension"
import { DocumentImage } from "../../src/renderer/components/documents/document-image-extension"
import { DocumentTaskItem } from "../../src/renderer/components/documents/document-task-item-extension"

describe("显式生成上游 2e23981 Yjs 夹具", () => {
  it.runIf(process.env.MAGICCHAT_GENERATE_YJS_FIXTURE === "1")(
    "从固定 Schema 和节点清单生成二进制状态",
    () => {
      const document = new Y.Doc()
      const content = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "可编辑基础段落" }] },
          {
            type: "documentImage",
            attrs: {
              alignment: "right",
              alt: "固定图片",
              externalUrl: null,
              fileId: "file-fixture-1",
              width: 65,
            },
          },
          { type: "horizontalRule", attrs: { lineStyle: "dotted", thickness: 5 } },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "表头" }] }],
                  },
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "第二列" }] }],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "内容" }] }],
                  },
                  { type: "tableCell", content: [{ type: "paragraph" }] },
                ],
              },
            ],
          },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [{ type: "paragraph", content: [{ type: "text", text: "完成事项" }] }],
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                marks: [{ type: "highlight", attrs: { color: "#fef08a" } }],
                text: "高亮文字",
              },
            ],
          },
        ],
      }
      const editor = new Editor({
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
      editor.commands.setContent(content)
      const target = path.resolve(
        "src/renderer/test/fixtures/web-composite-document-2e23981/state.yjs",
      )
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, Y.encodeStateAsUpdate(document))
      expect(fs.statSync(target).size).toBeGreaterThan(0)
      editor.destroy()
      document.destroy()
    },
  )
})
