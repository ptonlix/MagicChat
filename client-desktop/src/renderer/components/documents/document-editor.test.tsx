import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import { TooltipProvider } from "@/components/ui/tooltip"
import { DocumentEditor } from "./document-editor"

describe("DocumentEditor", () => {
  it("初始化标题、正文和 Placeholder，并允许键盘焦点进入正文", async () => {
    const document = new Y.Doc()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        title="一份很长但必须完整显示的文档标题"
      />,
    )

    const title = screen.getByRole("textbox", { name: "文档页面标题" })
    expect(title).toHaveValue("一份很长但必须完整显示的文档标题")
    expect(title).not.toHaveAttribute("maxlength")
    const body = await screen.findByLabelText("文档正文")
    expect(body).toHaveAttribute("contenteditable", "true")
    expect(body.querySelector("p")).toHaveAttribute("data-placeholder", "开始撰写文档...")
    body.focus()
    expect(body).toHaveFocus()
  })

  it("只读状态禁用标题和正文编辑", async () => {
    const document = new Y.Doc()
    renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={() => undefined}
        onTitleChange={() => undefined}
        readOnly
        title="只读文档"
      />,
    )

    expect(screen.getByRole("textbox", { name: "文档页面标题" })).toBeDisabled()
    expect(await screen.findByLabelText("文档正文")).toHaveAttribute("contenteditable", "false")
  })

  it("转发标题输入和失焦，并在卸载时解除 Y.Doc 监听", async () => {
    const document = new Y.Doc()
    const onTitleBlur = vi.fn()
    const onTitleChange = vi.fn()
    const before = observerCount(document)
    const view = renderEditor(
      <DocumentEditor
        collaborationDocument={document}
        onTitleBlur={onTitleBlur}
        onTitleChange={onTitleChange}
        title="标题"
      />,
    )
    const title = screen.getByRole("textbox", { name: "文档页面标题" })
    fireEvent.change(title, { target: { value: "新标题" } })
    fireEvent.blur(title)
    expect(onTitleChange).toHaveBeenCalledWith("新标题")
    expect(onTitleBlur).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(observerCount(document)).toBeGreaterThan(before))
    view.unmount()
    await waitFor(() => expect(observerCount(document)).toBe(before))
  })

  it("按 Unicode 字符限制标题输入，不会把 emoji 按两个字符计算", () => {
    const onTitleChange = vi.fn()
    renderEditor(
      <DocumentEditor
        collaborationDocument={new Y.Doc()}
        onTitleBlur={() => undefined}
        onTitleChange={onTitleChange}
        title=""
      />,
    )
    fireEvent.change(screen.getByRole("textbox", { name: "文档页面标题" }), {
      target: { value: `${"😀".repeat(500)}尾` },
    })
    expect(onTitleChange).toHaveBeenCalledWith("😀".repeat(500))
  })
})

function renderEditor(element: ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>)
}

function observerCount(document: Y.Doc): number {
  const observers = (
    document as unknown as { _observers: Map<string, Set<(...args: unknown[]) => void>> }
  )._observers
  return [...observers.values()].reduce((total, listeners) => total + listeners.size, 0)
}
