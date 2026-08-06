import { readFile } from "node:fs/promises"
import path from "node:path"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"

describe("Sheet", () => {
  it("keeps floating portals above the drawer layer", async () => {
    const css = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")

    expect(css).toMatch(/\[data-slot="sheet-content"\][\s\S]*z-index:\s*60/)
    expect(css).toMatch(/\[data-slot="dialog-content"\][\s\S]*z-index:\s*70/)
    expect(css).toMatch(/\[data-slot="dropdown-menu-content"\][\s\S]*z-index:\s*70/)
  })

  it("closes when the top-right close button is clicked", async () => {
    const user = userEvent.setup()

    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>抽屉标题</SheetTitle>
          <SheetDescription>抽屉描述</SheetDescription>
        </SheetContent>
      </Sheet>,
    )

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Close" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})
