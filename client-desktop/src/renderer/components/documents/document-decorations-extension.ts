import { Extension } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

const activeTableCellPluginKey = new PluginKey("activeTableCell")
type ActiveBlockDecoration = Readonly<{
  node: ProseMirrorNode
  pos: number
}>

export const documentActiveBlockPluginKey = new PluginKey<ActiveBlockDecoration | null>(
  "activeBlock",
)

export const DocumentDecorations = Extension.create({
  name: "documentDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: activeTableCellPluginKey,
        props: {
          decorations(state) {
            const selection = state.selection
            if (selection instanceof CellSelection) return DecorationSet.empty

            const $anchor = selection.$anchor
            for (let depth = $anchor.depth; depth > 0; depth -= 1) {
              const node = $anchor.node(depth)
              if (node.type.name !== "tableCell" && node.type.name !== "tableHeader") continue

              const from = $anchor.before(depth)
              return DecorationSet.create(state.doc, [
                Decoration.node(from, from + node.nodeSize, {
                  class: "document-table-active-cell",
                }),
              ])
            }
            return DecorationSet.empty
          },
        },
      }),
      new Plugin<ActiveBlockDecoration | null>({
        key: documentActiveBlockPluginKey,
        state: {
          init: () => null,
          apply(transaction, activeBlock) {
            const nextActiveBlockPos = transaction.getMeta(documentActiveBlockPluginKey) as
              | number
              | null
              | undefined
            if (nextActiveBlockPos !== undefined) {
              if (nextActiveBlockPos === null) return null
              const node = transaction.doc.nodeAt(nextActiveBlockPos)
              return node ? { node, pos: nextActiveBlockPos } : null
            }
            if (activeBlock === null) return null

            const mapped = transaction.mapping.mapResult(activeBlock.pos)
            if (!mapped.deleted) {
              const node = transaction.doc.nodeAt(mapped.pos)
              return node ? { node, pos: mapped.pos } : null
            }

            // y-prosemirror 有时会将远端局部变更表示为根节点替换，保留唯一可识别的活动块。
            const equivalentPosition = findUniqueEquivalentNodePosition(
              transaction.doc,
              activeBlock.node,
            )
            if (equivalentPosition === null) return null
            const node = transaction.doc.nodeAt(equivalentPosition)
            return node ? { node, pos: equivalentPosition } : null
          },
        },
        props: {
          decorations(state) {
            const activeBlock = documentActiveBlockPluginKey.getState(state)
            if (activeBlock === null || activeBlock === undefined) return DecorationSet.empty

            const node = state.doc.nodeAt(activeBlock.pos)
            if (!node) return DecorationSet.empty

            return DecorationSet.create(state.doc, [
              Decoration.node(activeBlock.pos, activeBlock.pos + node.nodeSize, {
                class: "document-block-active",
              }),
            ])
          },
        },
      }),
    ]
  },
})

function findUniqueEquivalentNodePosition(
  document: ProseMirrorNode,
  activeNode: ProseMirrorNode,
): number | null {
  let position: number | null = null
  let hasMultipleMatches = false
  document.descendants((node, nodePosition) => {
    if (!node.eq(activeNode)) return
    if (position !== null) {
      hasMultipleMatches = true
      return false
    }
    position = nodePosition
    return false
  })
  return hasMultipleMatches ? null : position
}
