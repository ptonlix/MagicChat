import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider, useTheme } from "@/components/theme-provider"

const setThemeSource = vi.fn().mockResolvedValue(undefined)
const originalDesktop = window.desktop
let handleColorSchemeChange: (() => void) | undefined

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear()
    setThemeSource.mockClear()
    handleColorSchemeChange = undefined
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: (_event: string, listener: () => void) => {
          handleColorSchemeChange = listener
        },
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        appearance: { setThemeSource },
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: originalDesktop,
    })
  })

  it("同步跟随系统和用户选择到 Electron 原生主题", async () => {
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    )

    await waitFor(() => expect(setThemeSource).toHaveBeenCalledWith("system"))

    fireEvent.click(screen.getByRole("button", { name: "切换明亮主题" }))

    await waitFor(() => expect(setThemeSource).toHaveBeenLastCalledWith("light"))
  })

  it("系统明暗模式变化时重新同步 Electron 原生主题", async () => {
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    )

    await waitFor(() => expect(setThemeSource).toHaveBeenCalledOnce())

    handleColorSchemeChange?.()

    await waitFor(() => expect(setThemeSource).toHaveBeenCalledTimes(2))
    expect(setThemeSource).toHaveBeenLastCalledWith("system")
  })
})

function ThemeControl() {
  const { setTheme } = useTheme()
  return (
    <button type="button" onClick={() => setTheme("light")}>
      切换明亮主题
    </button>
  )
}
