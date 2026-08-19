import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { InputGroupButton } from "@/components/ui/input-group"

describe("InputGroupButton", () => {
  it("把文字和图标尺寸传递给底层 Button 变体", () => {
    const view = render(
      <InputGroupButton aria-label="小图标" size="icon-xs">
        图标
      </InputGroupButton>,
    )
    const iconButton = screen.getByRole("button", { name: "小图标" })
    expect(iconButton).toHaveAttribute("data-size", "icon-xs")
    expect(iconButton).toHaveClass("size-6")
    expect(iconButton).not.toHaveClass("h-9")

    view.rerender(<InputGroupButton size="sm">文字按钮</InputGroupButton>)
    const textButton = screen.getByRole("button", { name: "文字按钮" })
    expect(textButton).toHaveAttribute("data-size", "sm")
    expect(textButton).toHaveClass("h-8")
    expect(textButton).not.toHaveClass("h-9")
  })
})
