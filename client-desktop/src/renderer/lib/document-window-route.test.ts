import { afterEach, describe, expect, it, vi } from "vitest"

import {
  documentNavigationPath,
  documentWindowFeedbackMessage,
  getDocumentReturnPath,
  parseDocumentWindowLocation,
  rememberLastNonDocumentRoute,
  requestDocumentWindow,
} from "./document-window-route"

describe("文档窗口渲染路由", () => {
  afterEach(() => {
    rememberLastNonDocumentRoute({ hash: "", pathname: "/chat", search: "" })
    vi.unstubAllGlobals()
  })

  it("只将显式 window=document 的路由识别为子窗口", () => {
    expect(
      parseDocumentWindowLocation({
        pathname: "/documents/document/550e8400-e29b-41d4-a716-446655440000",
        search: "",
      }),
    ).toEqual({ kind: "none" })

    expect(
      parseDocumentWindowLocation({
        pathname: "/documents/document/550e8400-e29b-41d4-a716-446655440000",
        search: "?serverId=server-a&window=document",
      }),
    ).toEqual({
      context: {
        documentId: "550e8400-e29b-41d4-a716-446655440000",
        mode: "document",
        serverId: "server-a",
      },
      kind: "document",
    })
  })

  it("拒绝缺少认证目标、非法文档标识和任意窗口模式", () => {
    expect(
      parseDocumentWindowLocation({
        pathname: "/documents/document/550e8400-e29b-41d4-a716-446655440000",
        search: "?window=document",
      }),
    ).toMatchObject({ kind: "invalid" })
    expect(
      parseDocumentWindowLocation({
        pathname: "/documents/document/not-a-uuid",
        search: "?serverId=server-a&window=document",
      }),
    ).toMatchObject({ kind: "invalid" })
    expect(
      parseDocumentWindowLocation({
        pathname: "/documents/document/550e8400-e29b-41d4-a716-446655440000",
        search: "?serverId=server-a&window=chat",
      }),
    ).toMatchObject({ kind: "invalid" })
  })

  it("统一转换 Bridge 结果并保留重复打开的聚焦状态", async () => {
    const openDocumentWindow = vi.fn().mockResolvedValue({
      ok: true,
      result: { status: "focused" },
    })
    vi.stubGlobal("window", { desktop: { navigation: { openDocumentWindow } } })

    await expect(
      requestDocumentWindow("550e8400-e29b-41d4-a716-446655440000", "server-a"),
    ).resolves.toEqual({ status: "focused" })
    expect(openDocumentWindow).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      "server-a",
    )
    expect(documentWindowFeedbackMessage("window_limit", "fallback")).toContain("8")
  })

  it("子窗口内切换文档时保留显式 Server 和窗口模式", () => {
    vi.stubGlobal("window", {
      location: {
        pathname: "/documents/document/550e8400-e29b-41d4-a716-446655440000",
        search: "?serverId=server-a&window=document",
      },
    })
    expect(documentNavigationPath("650e8400-e29b-41d4-a716-446655440000", "server-a")).toBe(
      "/documents/document/650e8400-e29b-41d4-a716-446655440000?serverId=server-a&window=document",
    )
    expect(documentNavigationPath("650e8400-e29b-41d4-a716-446655440000", "server-b")).toBe(
      "/documents/document/650e8400-e29b-41d4-a716-446655440000",
    )
  })

  it("记录最近非文档页面，并忽略文档路由", () => {
    rememberLastNonDocumentRoute({
      hash: "#editing",
      pathname: "/projects/project-1/documents",
      search: "?view=grid",
    })
    rememberLastNonDocumentRoute({
      hash: "",
      pathname: "/documents/document/550e8400-e29b-41d4-a716-446655440000",
      search: "",
    })

    expect(getDocumentReturnPath("/chat")).toBe("/projects/project-1/documents?view=grid#editing")
  })
})
