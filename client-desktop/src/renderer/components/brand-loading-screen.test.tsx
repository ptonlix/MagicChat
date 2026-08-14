import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { BrandLoadingScreen } from "@/components/brand-loading-screen"

describe("BrandLoadingScreen", () => {
  it("在启动文案前展示带动效的茉莉标识", () => {
    render(<BrandLoadingScreen detail="正在准备你的即应空间" message="正在启动即应" />)

    expect(screen.getByRole("img", { name: "茉莉正在准备工作空间" })).toBeVisible()
    expect(screen.getByText("正在启动即应")).toBeVisible()
    expect(screen.getByText("正在准备你的即应空间")).toBeVisible()
    expect(screen.getByRole("progressbar", { name: "加载进度" })).toBeVisible()
  })
})
