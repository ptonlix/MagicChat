import { describe, expect, it } from "vitest"
import {
  normalizeProjectSectionPath,
  projectSectionPath,
  projectSections,
} from "./project-section-routing"

describe("项目 section 路由", () => {
  it.each(projectSections)("生成 %s 内容区地址", (section) => {
    expect(projectSectionPath("project/一", section)).toBe(
      `/projects/project%2F%E4%B8%80/${section}`,
    )
  })

  it.each([undefined, "", "unknown"])("将旧或未知 section %s 规范化到 tasks", (section) => {
    expect(normalizeProjectSectionPath("project-1", section, "?taskId=task-1&source=card")).toBe(
      "/projects/project-1/tasks?taskId=task-1&source=card",
    )
  })

  it("将旧 topics 地址兼容到 discussions 并保留查询参数", () => {
    expect(normalizeProjectSectionPath("project-1", "topics", "?source=legacy")).toBe(
      "/projects/project-1/discussions?source=legacy",
    )
  })

  it.each(projectSections)("保留直接加载 %s section 及全部查询参数", (section) => {
    expect(normalizeProjectSectionPath("project-1", section, "?taskId=t%2F1&source=link")).toBe(
      `/projects/project-1/${section}?taskId=t%2F1&source=link`,
    )
  })

  it.each([
    [undefined, "", "/projects/project-1/tasks"],
    ["", "?taskId=task-1", "/projects/project-1/tasks?taskId=task-1"],
    [
      "unknown",
      "?taskId=task-1&source=card",
      "/projects/project-1/tasks?taskId=task-1&source=card",
    ],
    ["documents", "?source=link", "/projects/project-1/documents?source=link"],
    ["members", "?source=back", "/projects/project-1/members?source=back"],
  ] as const)("覆盖旧链接、未知 section 和新 section 的地址矩阵", (section, search, expected) => {
    expect(normalizeProjectSectionPath("project-1", section, search)).toBe(expected)
  })

  it("对项目 ID 仅编码一次", () => {
    expect(normalizeProjectSectionPath("project/一", "documents", "")).toBe(
      "/projects/project%2F%E4%B8%80/documents",
    )
  })
})
