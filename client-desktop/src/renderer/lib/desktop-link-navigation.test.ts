import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  classifyDesktopLink,
  installDesktopLinkNavigation,
} from "@/lib/desktop-link-navigation"

describe("Desktop 链接导航", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("将开发服务器中的站内路径交给 Router", () => {
    const anchor = document.createElement("a")
    anchor.href = "/contacts"

    expect(
      classifyDesktopLink(anchor, "http://localhost:20050/chat")
    ).toEqual({ action: "internal" })
  })

  it("不会取消站内菜单的点击事件", () => {
    const openExternal = vi.fn()
    const restore = installDesktopLinkNavigation(openExternal)
    const anchor = document.createElement("a")
    anchor.href = "/contacts"
    document.body.append(anchor)
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    let preventedByDesktopHandler = true
    anchor.addEventListener("click", (clickEvent) => {
      preventedByDesktopHandler = clickEvent.defaultPrevented
      clickEvent.preventDefault()
    })

    try {
      anchor.dispatchEvent(event)
      expect(preventedByDesktopHandler).toBe(false)
      expect(openExternal).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it("通过系统浏览器打开外部 HTTPS 链接", () => {
    const openExternal = vi.fn()
    const restore = installDesktopLinkNavigation(openExternal)
    const anchor = document.createElement("a")
    anchor.href = "https://example.com/docs"
    document.body.append(anchor)
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })

    try {
      anchor.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(openExternal).toHaveBeenCalledWith("https://example.com/docs")
    } finally {
      restore()
    }
  })

  it("继续阻止不安全的外部 HTTP 链接", () => {
    const openExternal = vi.fn()
    const restore = installDesktopLinkNavigation(openExternal)
    const anchor = document.createElement("a")
    anchor.href = "http://example.com/docs"
    document.body.append(anchor)
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })

    try {
      anchor.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(openExternal).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})
