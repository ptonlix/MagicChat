import type { Node as ProseMirrorNode } from "@tiptap/pm/model"

export function isDocumentBlockTransformable(node: ProseMirrorNode | null): boolean {
  return Boolean(node && !node.isAtom && node.type.name !== "table")
}
