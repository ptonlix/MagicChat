import { mergeAttributes, Node as TiptapNode } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { DocumentImageNodeView } from "./document-image-node"
import { normalizeDocumentImageAttributes } from "./document-image-attributes"

export {
  isLoadableDocumentExternalImage,
  normalizeDocumentImageAttributes,
} from "./document-image-attributes"
export type { DocumentImageAttributes } from "./document-image-attributes"

export const DocumentImage = TiptapNode.create({
  name: "documentImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    const parse = (element: HTMLElement) =>
      normalizeDocumentImageAttributes({
        alignment: element.getAttribute("data-alignment"),
        alt: element.getAttribute("data-alt"),
        externalUrl: element.getAttribute("data-external-url"),
        fileId: element.getAttribute("data-file-id"),
        width: element.getAttribute("data-width"),
      })
    return {
      alignment: { default: "center", parseHTML: (element) => parse(element).alignment },
      alt: { default: "", parseHTML: (element) => parse(element).alt },
      externalUrl: { default: null, parseHTML: (element) => parse(element).externalUrl },
      fileId: { default: null, parseHTML: (element) => parse(element).fileId },
      width: { default: 100, parseHTML: (element) => parse(element).width },
    }
  },
  parseHTML() {
    return [{ tag: "figure[data-document-image]" }]
  },
  renderHTML({ HTMLAttributes }) {
    const attributes = normalizeDocumentImageAttributes(HTMLAttributes)
    return [
      "figure",
      mergeAttributes({
        "data-document-image": "",
        "data-alignment": attributes.alignment,
        "data-alt": attributes.alt,
        "data-external-url": attributes.externalUrl,
        "data-file-id": attributes.fileId,
        "data-width": attributes.width,
      }),
      ["span", {}, "文档图片"],
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DocumentImageNodeView)
  },
})

export function collectDocumentImageFileIds(document: ProseMirrorNode): string[] {
  const ids = new Set<string>()
  document.descendants((node) => {
    if (node.type.name === DocumentImage.name && typeof node.attrs.fileId === "string") {
      ids.add(node.attrs.fileId)
    }
  })
  return [...ids]
}

export function transactionChangesDocumentImages(transaction: Transaction): boolean {
  return transaction.steps.some((step, index) => {
    const before = transaction.docs[index]
    const after = transaction.docs[index + 1] ?? transaction.doc
    let changed = false
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      before?.nodesBetween(oldStart, oldEnd, (node) => {
        if (node.type.name === DocumentImage.name) changed = true
      })
      after?.nodesBetween(newStart, newEnd, (node) => {
        if (node.type.name === DocumentImage.name) changed = true
      })
    })
    return changed
  })
}
