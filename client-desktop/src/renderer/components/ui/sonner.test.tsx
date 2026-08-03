import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { toast } from "sonner"

import { Toaster } from "@/components/ui/sonner"

describe("Toaster", () => {
  afterEach(() => toast.dismiss())

  it("关闭按钮使用中文名称并关闭提示", async () => {
    render(<Toaster />)

    act(() => {
      toast.error("需要开启屏幕录制权限", {
        closeButton: true,
        duration: Infinity,
      })
    })

    const closeButton = await screen.findByRole("button", { name: "关闭提示" })
    fireEvent.click(closeButton)

    await waitFor(() => expect(screen.queryByText("需要开启屏幕录制权限")).not.toBeInTheDocument())
  })
})
