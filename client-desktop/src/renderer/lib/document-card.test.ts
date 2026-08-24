import { describe, expect, it } from "vitest"

import { createDocumentCard, createDocumentCardTitle } from "@/lib/document-card"

describe("document card", () => {
  it("uses an internal, encoded document route and project description", () => {
    expect(createDocumentCard("folder/a?draft=1", "设计文档", "客户端")).toEqual({
      description: "项目: 客户端",
      title: "文档 - 设计文档",
      type: "card",
      url: "/documents/document/folder%2Fa%3Fdraft%3D1",
    })
  })

  it("uses the Markdown route for Markdown documents", () => {
    expect(createDocumentCard("document-1", "协作说明", "客户端", "markdown")).toMatchObject({
      url: "/documents/markdown/document-1",
    })
  })

  it("uses a stable untitled fallback and truncates by Unicode character", () => {
    expect(createDocumentCardTitle(" ")).toBe("文档 - 无标题文档")
    const title = createDocumentCardTitle("😀".repeat(300))
    expect(Array.from(title)).toHaveLength(256)
    expect(title).toMatch(/^文档 - /)
    expect(title).toMatch(/…$/)
  })
})
