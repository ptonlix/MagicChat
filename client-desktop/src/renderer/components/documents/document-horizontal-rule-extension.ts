import HorizontalRule from "@tiptap/extension-horizontal-rule"
import { ReactNodeViewRenderer } from "@tiptap/react"

import { DocumentHorizontalRuleNodeView } from "./document-horizontal-rule-node"
import { normalizeHorizontalRuleAttributes } from "./document-horizontal-rule-attributes"

export { normalizeHorizontalRuleAttributes } from "./document-horizontal-rule-attributes"

export const DocumentHorizontalRule = HorizontalRule.extend({
  addAttributes() {
    return {
      lineStyle: {
        default: "solid",
        parseHTML: (element) =>
          normalizeHorizontalRuleAttributes({
            lineStyle: element.getAttribute("data-line-style"),
          }).lineStyle,
        renderHTML: (attributes) => ({
          "data-line-style": normalizeHorizontalRuleAttributes(attributes).lineStyle,
        }),
      },
      thickness: {
        default: 1,
        parseHTML: (element) =>
          normalizeHorizontalRuleAttributes({
            thickness: element.getAttribute("data-thickness"),
          }).thickness,
        renderHTML: (attributes) => ({
          "data-thickness": normalizeHorizontalRuleAttributes(attributes).thickness,
        }),
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocumentHorizontalRuleNodeView)
  },
})
