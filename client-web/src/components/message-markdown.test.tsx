import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MessageMarkdown } from "@/components/message-markdown"

describe("MessageMarkdown", () => {
  it("uses the mono font and highlights fenced code", async () => {
    const { container } = render(
      <MessageMarkdown
        content={
          "`inline`\n\n```\ndef func():\n    pass\n```\n\n```python\ndef func():\n    pass\n```"
        }
      />
    )

    expect(container.querySelector("p code")).toHaveClass("font-mono!")
    expect(container.querySelector("pre > code")).toHaveClass("font-mono!")
    await waitFor(
      () => {
        expect(
          container.querySelector(".markdown-code-highlight .shiki")
        ).toBeInTheDocument()
      },
      { timeout: 10_000 }
    )
    expect(container.querySelector(".shiki")?.getAttribute("style")).toContain(
      "--shiki-dark"
    )
    expect(container.querySelector(".markdown-code-highlight")).toHaveClass(
      "font-mono!"
    )
  })

  it("preserves rendered DOM nodes when only the mention resolver changes", () => {
    const { rerender } = render(
      <MessageMarkdown
        content="一段可选择的消息"
        currentUserId="user-1"
        mentionLabelResolver={() => "旧名称"}
      />
    )
    const paragraph = screen.getByText("一段可选择的消息")

    rerender(
      <MessageMarkdown
        content="一段可选择的消息"
        currentUserId="user-1"
        mentionLabelResolver={() => "新名称"}
      />
    )

    expect(screen.getByText("一段可选择的消息")).toBe(paragraph)
  })
})
