import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CollapsibleMessageContent } from "./collapsible-message-content"

describe("CollapsibleMessageContent", () => {
  afterEach(() => vi.restoreAllMocks())

  it("按 Markdown 阈值折叠并支持展开", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 500,
    })
    try {
      render(
        <CollapsibleMessageContent variant="markdown">
          <p>长内容</p>
        </CollapsibleMessageContent>,
      )
      expect(screen.getByText("长内容").closest<HTMLElement>("[id]")).toHaveStyle({
        maxHeight: "360px",
      })
      const expandButton = screen.getByRole("button", { name: "展开全文" })
      expect(expandButton).toHaveAttribute("aria-expanded", "false")
      await userEvent.click(expandButton)
      const collapseButton = screen.getByRole("button", { name: "收起全文" })
      expect(collapseButton).toHaveAttribute("aria-expanded", "true")
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, "scrollHeight", descriptor)
      else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    }
  })

  it("短内容和禁用状态不显示展开控制", () => {
    render(
      <CollapsibleMessageContent enabled={false} variant="text">
        <span>完整内容</span>
      </CollapsibleMessageContent>,
    )
    expect(screen.queryByRole("button", { name: "展开全文" })).not.toBeInTheDocument()
  })

  it("按文本阈值处理边界并响应异步内容增高", () => {
    let height = 273
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height)
    let callback: ResizeObserverCallback | undefined
    const disconnect = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(next: ResizeObserverCallback) {
          callback = next
        }
        disconnect = disconnect
        observe() {}
      },
    )
    const view = render(
      <CollapsibleMessageContent variant="text">边界内容</CollapsibleMessageContent>,
    )
    expect(screen.queryByRole("button", { name: "展开全文" })).not.toBeInTheDocument()
    height = 274
    act(() => callback?.([], {} as ResizeObserver))
    expect(screen.queryByRole("button", { name: "展开全文" })).not.toBeInTheDocument()
    height = 275
    act(() => callback?.([], {} as ResizeObserver))
    expect(screen.getByRole("button", { name: "展开全文" })).toBeInTheDocument()
    view.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it("缺少 ResizeObserver 时清理窗口监听并隔离控制事件", async () => {
    vi.stubGlobal("ResizeObserver", undefined)
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500)
    const remove = vi.spyOn(window, "removeEventListener")
    const parentClick = vi.fn()
    const parentContextMenu = vi.fn()
    const view = render(
      <div onClick={parentClick} onContextMenu={parentContextMenu}>
        <CollapsibleMessageContent variant="text">长内容</CollapsibleMessageContent>
      </div>,
    )
    const button = screen.getByRole("button", { name: "展开全文" })
    fireEvent.contextMenu(button)
    expect(parentContextMenu).not.toHaveBeenCalled()
    await userEvent.click(button)
    expect(parentClick).not.toHaveBeenCalled()
    view.unmount()
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function))
    vi.unstubAllGlobals()
  })

  it("更换消息键后不复用上一条消息的展开状态", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500)
    const view = render(
      <CollapsibleMessageContent key="message-1" variant="text">
        第一条
      </CollapsibleMessageContent>,
    )
    await userEvent.click(screen.getByRole("button", { name: "展开全文" }))
    expect(screen.getByRole("button", { name: "收起全文" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    view.rerender(
      <CollapsibleMessageContent key="message-2" variant="text">
        第二条
      </CollapsibleMessageContent>,
    )
    expect(screen.getByRole("button", { name: "展开全文" })).toBeInTheDocument()
  })
})
