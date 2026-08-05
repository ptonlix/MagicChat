import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { TextSelection, type Transaction } from "@tiptap/pm/state"

export type ActiveDocumentBlock = Readonly<{
  nodeSize: number
  pos: number
}>

export type BlockFormat =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"

export function isDocumentBlockTransformable(node: ProseMirrorNode | null): boolean {
  return Boolean(node && !node.isAtom && node.type.name !== "table")
}

export function mapActiveDocumentBlock(
  activeBlock: ActiveDocumentBlock,
  transaction: Transaction,
): ActiveDocumentBlock | null {
  if (!transaction.docChanged) return activeBlock

  const from = transaction.mapping.mapResult(activeBlock.pos, 1)
  const to = transaction.mapping.mapResult(activeBlock.pos + activeBlock.nodeSize, -1)
  if (from.deleted || to.deleted || to.pos <= from.pos) return null

  const node = transaction.doc.nodeAt(from.pos)
  return node ? { nodeSize: node.nodeSize, pos: from.pos } : null
}

export function transformDocumentBlock(
  editor: Editor,
  activeBlock: ActiveDocumentBlock,
  format: BlockFormat,
): boolean {
  const node = editor.state.doc.nodeAt(activeBlock.pos)
  if (!node || !isDocumentBlockTransformable(node)) return false

  let selectionPos = activeBlock.pos + 1
  let selectionNode = node
  while (!selectionNode.isTextblock && selectionNode.firstChild) {
    selectionNode = selectionNode.firstChild
    selectionPos += 1
  }
  const resolvedSelection = editor.state.doc.resolve(selectionPos)
  const hasAncestor = (name: string) =>
    Array.from({ length: resolvedSelection.depth + 1 }, (_, index) => index).some(
      (depth) => resolvedSelection.node(depth).type.name === name,
    )
  const chain = editor.chain().focus().setTextSelection(selectionPos)

  if (hasAncestor("bulletList")) chain.toggleBulletList()
  if (hasAncestor("orderedList")) chain.toggleOrderedList()
  if (hasAncestor("taskList")) chain.toggleTaskList()
  if (hasAncestor("blockquote")) chain.toggleBlockquote()
  if (hasAncestor("codeBlock")) chain.toggleCodeBlock()

  chain
    .command(({ tr }) => {
      const mappedSelectionPos = tr.mapping.map(selectionPos, 1)
      tr.setSelection(TextSelection.near(tr.doc.resolve(mappedSelectionPos)))
      return true
    })
    .clearNodes()
    .command(({ tr }) => {
      const mappedSelectionPos = tr.mapping.map(selectionPos, 1)
      tr.setSelection(TextSelection.near(tr.doc.resolve(mappedSelectionPos)))
      return true
    })

  switch (format) {
    case "heading-1":
      chain.setHeading({ level: 1 })
      break
    case "heading-2":
      chain.setHeading({ level: 2 })
      break
    case "heading-3":
      chain.setHeading({ level: 3 })
      break
    case "bullet-list":
      chain.toggleBulletList()
      break
    case "ordered-list":
      chain.toggleOrderedList()
      break
    case "task-list":
      chain.toggleTaskList()
      break
    case "blockquote":
      chain.toggleBlockquote()
      break
    case "code-block":
      chain.toggleCodeBlock()
      break
    case "paragraph":
      break
  }

  return chain.run()
}
