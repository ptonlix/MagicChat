import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MessageTextWithLinks } from "@/components/message-inline-link"

describe("MessageTextWithLinks", () => {
  it("renders detected URLs with the Markdown message link behavior", () => {
    render(
      <MessageTextWithLinks text="打开 https://example.com/path?q=1#detail 查看" />
    )

    const link = screen.getByRole("link", {
      name: "https://example.com/path?q=1#detail",
    })

    expect(link).toHaveAttribute("href", "https://example.com/path?q=1#detail")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noreferrer")
    expect(link).toHaveClass(
      "mx-0.5",
      "break-all",
      "font-medium",
      "text-sky-500",
      "underline-offset-4",
      "hover:text-sky-600"
    )
    expect(link).not.toHaveClass("hover:underline")
  })
})
