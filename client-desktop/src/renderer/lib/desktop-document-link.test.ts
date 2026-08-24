import { describe, expect, it } from "vitest"

import { parseDesktopDocumentLink } from "@/lib/desktop-document-link"

const documentId = "550e8400-e29b-41d4-a716-446655440000"
const target = { normalizedUrl: "https://chat.example.com" }

describe("桌面端文档链接解析", () => {
  it("识别当前 HTTPS Server 的文档链接并规范化 UUID", () => {
    expect(
      parseDesktopDocumentLink(
        `https://chat.example.com/documents/document/${documentId.toUpperCase()}`,
        target,
      ),
    ).toEqual({ documentId, documentType: "document" })
  })

  it("支持规范化 Server 的路径前缀和端口", () => {
    expect(
      parseDesktopDocumentLink(
        `https://chat.example.com:8443/magicchat/documents/document/${documentId}`,
        { normalizedUrl: "https://chat.example.com:8443/magicchat" },
      ),
    ).toEqual({ documentId, documentType: "document" })
  })

  it("识别 Markdown 文档链接并返回文档类型", () => {
    expect(
      parseDesktopDocumentLink(`https://chat.example.com/documents/markdown/${documentId}`, target),
    ).toEqual({ documentId, documentType: "markdown" })
  })

  it.each([
    `http://chat.example.com/documents/document/${documentId}`,
    `https://other.example.com/documents/document/${documentId}`,
    `https://chat.example.com/other/documents/document/${documentId}`,
    `https://chat.example.com/documents/document/${documentId}/extra`,
    `https://chat.example.com/documents/document/${documentId}/`,
    `https://chat.example.com/documents/document/not-a-uuid`,
    `https://chat.example.com/documents/document/${documentId}?utm_source=share`,
    `https://chat.example.com/documents/document/${documentId}?`,
    `https://chat.example.com/documents/document/${documentId}#section`,
    `https://chat.example.com/documents/document/${documentId}#`,
    `https://user:password@chat.example.com/documents/document/${documentId}`,
    `https://chat.example.com/documents/document/${encodeURIComponent(`${documentId}/extra`)}`,
    "not a url",
  ])("拒绝不符合交接条件的链接：%s", (url) => {
    expect(() => parseDesktopDocumentLink(url, target)).not.toThrow()
    expect(parseDesktopDocumentLink(url, target)).toBeUndefined()
  })

  it("不会仅凭相同 Origin 接受其他部署路径", () => {
    expect(
      parseDesktopDocumentLink(`https://chat.example.com/other/documents/document/${documentId}`, {
        normalizedUrl: "https://chat.example.com/magicchat",
      }),
    ).toBeUndefined()
  })
})
