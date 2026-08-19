import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConversationStatusIndicator } from "@/components/conversation/conversation-status-indicator"

describe("ConversationStatusIndicator", () => {
  it("展示状态文本和三个动效圆点", () => {
    const { container } = render(<ConversationStatusIndicator announce status="正在思考" />)

    expect(screen.getByRole("status")).toHaveTextContent("正在思考")
    expect(container.querySelectorAll("[data-status-dot]")).toHaveLength(3)
  })
})
