import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LoginPage } from "@/pages/login-page"

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  finishedListener: undefined as
    | ((result: {
        error?: string
        status: "canceled" | "error" | "success"
        transactionId: string
      }) => void)
    | undefined,
  open: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock("@/lib/app-info-context", () => ({
  useAppInfo: () => ({
    appName: "MagicChat",
    authenticated: false,
    emailCodeLoginEnabled: true,
    organizationName: "测试组织",
    passwordLoginEnabled: true,
    setAuthenticated: vi.fn(),
    thirdPartyProviders: [{ key: "oidc", name: "OIDC" }],
  }),
}))
vi.mock("@/lib/desktop-host", () => ({
  cancelThirdPartyLogin: mocks.cancel,
  openThirdPartyLogin: mocks.open,
  subscribeThirdPartyLoginFinished: vi.fn((listener) => {
    mocks.finishedListener = listener
    return () => {
      mocks.finishedListener = undefined
    }
  }),
}))
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo },
}))

describe("Desktop 第三方登录", () => {
  beforeEach(() => {
    mocks.finishedListener = undefined
    mocks.cancel.mockResolvedValue(undefined)
    mocks.open.mockResolvedValue({ transactionId: "transaction-1" })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it("打开内嵌认证窗口并提供取消入口", async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole("link", { name: "使用 OIDC 登录" }))

    const cancel = await screen.findByRole("button", { name: "取消 OIDC 登录" })
    expect(mocks.toastInfo).toHaveBeenCalledWith("已打开第三方登录窗口")
    fireEvent.click(cancel)

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("transaction-1"))
  })

  it("认证窗口关闭后恢复登录入口", async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole("link", { name: "使用 OIDC 登录" }))
    await screen.findByRole("button", { name: "取消 OIDC 登录" })

    act(() => {
      mocks.finishedListener?.({
        status: "canceled",
        transactionId: "transaction-1",
      })
    })

    expect(
      await screen.findByRole("link", { name: "使用 OIDC 登录" })
    ).toBeInTheDocument()
    expect(mocks.toastInfo).toHaveBeenCalledWith("已关闭第三方登录窗口")
  })

  it("展示 Main 返回的认证错误", async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole("link", { name: "使用 OIDC 登录" }))
    await screen.findByRole("button", { name: "取消 OIDC 登录" })

    act(() => {
      mocks.finishedListener?.({
        error: "认证页面加载失败",
        status: "error",
        transactionId: "transaction-1",
      })
    })

    expect(mocks.toastError).toHaveBeenCalledWith("认证页面加载失败")
  })
})
