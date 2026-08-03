import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { toast } from "sonner"

import { Toaster } from "@/components/ui/sonner"

describe("Toaster", () => {
  afterEach(() => toast.dismiss())

  it("关闭按钮使用中文名称并关闭提示", async () => {
    render(<Toaster />)

    act(() => {
      toast.warning("需要开启屏幕录制权限", {
        closeButton: true,
        duration: Infinity,
      })
    })

    const closeButton = await screen.findByRole("button", { name: "关闭提示" })
    const styles = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")

    expect(document.querySelector(".lucide-triangle-alert")).not.toBeNull()
    expect(document.querySelector(".lucide-octagon-x")).toBeNull()
    expect(closeButton).toHaveClass("desktop-toast-close")
    expect(styles).toMatch(
      /\.cn-toast,[\s\S]*\.desktop-toast-close[\s\S]*-webkit-app-region:\s*no-drag/,
    )
    fireEvent.click(closeButton)

    await waitFor(() => expect(screen.queryByText("需要开启屏幕录制权限")).not.toBeInTheDocument())
  })
})
