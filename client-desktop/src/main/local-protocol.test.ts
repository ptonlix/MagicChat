import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}))

import { rewriteRendererEntryAssetPaths } from "@main/local-protocol"

describe("rewriteRendererEntryAssetPaths", () => {
  it("将 SPA 路由回退页面的入口资源改为协议根路径", () => {
    const html = [
      '<script src="./assets/index.js"></script>',
      '<link href="./assets/index.css">',
      '<link href="./favicon.webp">',
      '<a href="./relative-page">保留普通相对链接</a>',
    ].join("\n")

    expect(rewriteRendererEntryAssetPaths(html)).toBe(
      [
        '<script src="/assets/index.js"></script>',
        '<link href="/assets/index.css">',
        '<link href="/favicon.webp">',
        '<a href="./relative-page">保留普通相对链接</a>',
      ].join("\n"),
    )
  })
})
