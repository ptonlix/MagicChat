import { describe, expect, it } from "vitest"

import {
  buildDocumentWindowRoute,
  DOCUMENT_WINDOW_LIMITS,
  documentWindowKey,
  failedDocumentWindowResponse,
  normalizeDocumentWindowOpenResponse,
  parseDocumentWindowRequest,
} from "@shared/document-window-contract"

const documentId = "550e8400-e29b-41d4-a716-446655440000"

describe("文档窗口 Shared 契约", () => {
  it("只接受 documentId、documentType 和 serverId，并规范化文档 UUID", () => {
    expect(
      parseDocumentWindowRequest({
        documentId: documentId.toUpperCase(),
        documentType: "markdown",
        serverId: "server-1",
      }),
    ).toEqual({ documentId, documentType: "markdown", serverId: "server-1" })
    expect(() =>
      parseDocumentWindowRequest({
        documentId,
        documentType: "document",
        serverId: "server-1",
        url: "/",
      }),
    ).toThrow("字段无效")
    expect(() =>
      parseDocumentWindowRequest({
        documentId: "not-a-uuid",
        documentType: "document",
        serverId: "server-1",
      }),
    ).toThrow("文档标识无效")
    expect(() =>
      parseDocumentWindowRequest({ documentId, documentType: "unknown", serverId: "server-1" }),
    ).toThrow("文档类型无效")
    expect(() =>
      parseDocumentWindowRequest({ documentId, documentType: "document", serverId: "server/1" }),
    ).toThrow("服务器标识无效")
  })

  it("构造显式本地路由，并按完整目标隔离窗口键", () => {
    const request = { documentId, documentType: "markdown", serverId: "server-1" } as const
    expect(buildDocumentWindowRoute(request)).toBe(
      `magicchat-app://app/documents/markdown/${documentId}?serverId=server-1&window=document`,
    )
    expect(documentWindowKey(request, "user-1")).not.toBe(documentWindowKey(request, "user-2"))
    expect(DOCUMENT_WINDOW_LIMITS.maxPerTarget).toBe(8)
  })

  it("只接受已知结果和错误码，并复制为只读响应", () => {
    const response = normalizeDocumentWindowOpenResponse({
      ok: true,
      result: { status: "created" },
    })
    expect(response).toEqual({ ok: true, result: { status: "created" } })
    expect(Object.isFrozen(response)).toBe(true)
    if (response.ok) expect(Object.isFrozen(response.result)).toBe(true)
    expect(
      normalizeDocumentWindowOpenResponse(
        failedDocumentWindowResponse("window_limit", "请先关闭已有文档窗口"),
      ),
    ).toEqual({
      error: { code: "window_limit", message: "请先关闭已有文档窗口" },
      ok: false,
    })
    expect(() =>
      normalizeDocumentWindowOpenResponse({ ok: true, result: { status: "unknown" } }),
    ).toThrow("结果无效")
    expect(() =>
      normalizeDocumentWindowOpenResponse({ ok: false, error: { code: "unknown", message: "x" } }),
    ).toThrow("错误无效")
  })
})
