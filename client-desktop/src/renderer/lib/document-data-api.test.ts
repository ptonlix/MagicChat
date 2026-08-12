import { describe, expect, it, vi } from "vitest"

import {
  createClientDocument,
  deleteClientDocument,
  getClientDocument,
  listClientDocuments,
  moveClientDocument,
  updateClientDocument,
  updateCollaborativeDocumentTitle,
} from "./document-data-api"

const documentResponse = {
  created_at: "2026-08-04T09:00:00Z",
  creator: { avatar: "", id: "user-1", name: "林晓", nickname: "" },
  document_type: "document",
  id: "doc-1",
  kind: "document",
  parent_id: null,
  project_id: "project-1",
  schema_version: 1,
  sort_order: 0,
  title: "产品需求文档",
  updated_at: "2026-08-04T09:00:00Z",
  updated_by: { avatar: "", id: "user-1", name: "林晓", nickname: "" },
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}

describe("document data API", () => {
  it("收窄并冻结文档列表", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { documents: [{ ...documentResponse, project_id: "project/一" }] },
      }),
    )
    const documents = await listClientDocuments("project/一", fetcher)
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/projects/project%2F%E4%B8%80/documents",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    )
    expect(documents[0]).toMatchObject({ documentType: "document", title: "产品需求文档" })
    expect(Object.isFrozen(documents[0])).toBe(true)
  })

  it("归一化贡献者并兼容旧 Server 与非法计数", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          documents: [
            {
              ...documentResponse,
              contributor_count: 1,
              contributors: [
                { avatar: "", id: "user-2", name: "贡献者", nickname: "" },
                { avatar: "", id: "user-2", name: "重复", nickname: "" },
              ],
            },
          ],
        },
      }),
    )
    const [document] = await listClientDocuments("project-1", fetcher)
    expect(document?.contributors.map((user) => user.id)).toEqual(["user-2"])
    expect(document?.contributorCount).toBe(1)
    fetcher.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { documents: [{ ...documentResponse, contributor_count: -1 }] },
      }),
    )
    const [legacy] = await listClientDocuments("project-1", fetcher)
    expect(legacy?.contributors.map((user) => user.id)).toEqual(["user-1"])
    expect(legacy?.contributorCount).toBe(1)
  })

  it("accepts ID-only document users for later directory hydration", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          documents: [
            {
              ...documentResponse,
              contributors: [{ id: "user-2" }],
              creator: { id: "user-1" },
              updated_by: { id: "user-3" },
            },
          ],
        },
      }),
    )

    await expect(listClientDocuments("project-1", fetcher)).resolves.toMatchObject([
      {
        contributors: [{ id: "user-2", name: "" }],
        creator: { id: "user-1", name: "" },
        updatedBy: { id: "user-3", name: "" },
      },
    ])
  })

  it("按 Unicode 码点校验标题长度", async () => {
    const title = "😀".repeat(500)
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { documents: [{ ...documentResponse, title }] },
      }),
    )

    await expect(listClientDocuments("project-1", fetcher)).resolves.toEqual([
      expect.objectContaining({ title }),
    ])

    fetcher.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { documents: [{ ...documentResponse, title: `${title}😀` }] },
      }),
    )
    await expect(listClientDocuments("project-1", fetcher)).rejects.toThrow("文档响应格式不正确")
  })

  it.each([
    ["未知 kind", { ...documentResponse, kind: "board" }],
    ["错误 type", { ...documentResponse, document_type: "markdown" }],
    ["负排序", { ...documentResponse, sort_order: -1 }],
    ["错误 schema", { ...documentResponse, schema_version: 0 }],
    ["缺失字段", { ...documentResponse, creator: undefined }],
  ])("拒绝%s", async (_label, invalid) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { documents: [invalid] } }))
    await expect(listClientDocuments("project-1", fetcher)).rejects.toThrow(/响应格式|类型/)
  })

  it("拒绝重复 ID", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: { documents: [documentResponse, documentResponse] } }),
      )
    await expect(listClientDocuments("project-1", fetcher)).rejects.toThrow("重复标识")
  })

  it("拒绝混入其他项目的文档节点", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { documents: [{ ...documentResponse, project_id: "project-2" }] },
      }),
    )
    await expect(listClientDocuments("project-1", fetcher)).rejects.toThrow("不属于当前项目")
  })

  it("传递 Server 错误 envelope", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: false, error: { code: "forbidden", message: "没有权限" } }, 403),
      )
    await expect(getClientDocument("doc-1", fetcher)).rejects.toMatchObject({
      code: "forbidden",
      message: "没有权限",
      status: 403,
    })
  })

  it("覆盖创建、更新和移动 JSON 协议", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ success: true, data: documentResponse })),
      )
    await createClientDocument(
      "project-1",
      { kind: "folder", parentId: "folder-1", title: "资料" },
      fetcher,
    )
    await updateClientDocument("doc-1", { parentId: null, sortOrder: 2, title: "新标题" }, fetcher)
    await moveClientDocument("doc-1", { index: 1, parentId: "folder-1" }, fetcher)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      kind: "folder",
      parent_id: "folder-1",
      title: "资料",
    })
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      parent_id: null,
      sort_order: 2,
      title: "新标题",
    })
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      index: 1,
      parent_id: "folder-1",
    })
  })

  it("校验协作标题和删除响应", async () => {
    const titleFetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: { document_id: "doc-1", title: "标题" } }),
      )
    await expect(updateCollaborativeDocumentTitle("doc-1", "标题", titleFetcher)).resolves.toBe(
      "标题",
    )
    const deleteFetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: { deleted_count: 3, document_id: "doc-1" } }),
      )
    await expect(deleteClientDocument("doc-1", deleteFetcher)).resolves.toEqual({
      deletedCount: 3,
      documentId: "doc-1",
    })
  })

  it("沿标准 AbortSignal 取消请求", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) return Promise.reject(new DOMException("已取消", "AbortError"))
      return Promise.resolve(jsonResponse({}))
    })
    await expect(
      listClientDocuments("project-1", fetcher, controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    })
  })
})
