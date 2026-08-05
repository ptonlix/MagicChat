import TaskItem from "@tiptap/extension-task-item"
import { ReactNodeViewRenderer } from "@tiptap/react"

import { DocumentTaskItemNodeView } from "./document-task-item-node"

export const DocumentTaskItem = TaskItem.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DocumentTaskItemNodeView)
  },
}).configure({ nested: true })
