import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"

describe("Sheet", () => {
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
