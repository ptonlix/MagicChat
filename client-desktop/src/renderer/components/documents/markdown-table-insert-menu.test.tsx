import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MarkdownTableInsertMenu } from "@/components/documents/markdown-table-insert-menu"

vi.mock("@/components/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, number>) => {
      if (key === "document.table.insert") return "Insert table"
      if (key === "document.table.selectDimensions") return "Select table dimensions"
      if (key === "document.table.dimension")
        return `${params?.rows} rows ${params?.columns} columns`
      return key
    },
  }),
}))

describe("MarkdownTableInsertMenu", () => {
  it("localizes the grid, moves selection with arrow keys, and inserts the chosen dimensions", async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    render(<MarkdownTableInsertMenu onInsert={onInsert} />)

    await user.click(screen.getByRole("button", { name: "Insert table" }))
    expect(screen.getByRole("grid", { name: "Select table dimensions" })).toBeInTheDocument()

    const initialCell = screen.getByRole("gridcell", { name: "3 rows 3 columns" })
    initialCell.focus()
    fireEvent.keyDown(initialCell, { key: "ArrowRight" })
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "3 rows 4 columns" })).toHaveFocus(),
    )

    await user.click(screen.getByRole("gridcell", { name: "2 rows 4 columns" }))
    expect(onInsert).toHaveBeenCalledWith(2, 4)
    expect(screen.queryByRole("grid", { name: "Select table dimensions" })).not.toBeInTheDocument()
  })
})
