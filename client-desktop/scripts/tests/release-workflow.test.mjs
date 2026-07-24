import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repository = path.resolve(import.meta.dirname, "../../..")

describe("Desktop Stable Release 配置", () => {
  it("固定公开更新仓库与 Stable Release 类型", async () => {
    const builder = await readFile(
      path.join(repository, "client-desktop/electron-builder.yml"),
      "utf8",
    )
    expect(builder).toContain("owner: ptonlix")
    expect(builder).toContain("repo: MagicChat")
    expect(builder).toContain("releaseType: release")
    expect(builder).toContain("description: MagicChat Desktop Stable OTA 构建")
    expect(builder).not.toContain("experimentalUnsigned")
    expect(builder).not.toContain("实验性未签名")
    expect(builder).not.toContain("owner: magicchat")
  })

  it("只在聚合校验后创建非草稿、非预发布 Release", async () => {
    const workflow = await readFile(
      path.join(repository, ".github/workflows/desktop-release.yml"),
      "utf8",
    )
    expect(workflow).toContain('tags:\n      - "desktop-v*"')
    expect(workflow).toContain("release:aggregate")
    expect(workflow).toContain("verify:release-manifest")
    expect(workflow).toContain("--draft=false")
    expect(workflow).toContain("--prerelease=false")
    expect(workflow).toContain("gh release view")
    expect(workflow).not.toContain("--draft --prerelease")
    expect(workflow).not.toContain("MAGICCHAT_UNSIGNED_STABLE")
    expect(workflow).not.toContain("实验性未签名")
  })

  it("生成签名中立的正式 Stable Release Notes", async () => {
    const releaseNotes = await readFile(
      path.join(repository, "client-desktop/scripts/generate-release-notes.mjs"),
      "utf8",
    )
    expect(releaseNotes).toContain("# MagicChat Desktop ${version}")
    expect(releaseNotes).toContain("## 支持与更新载体")
    expect(releaseNotes).toContain("## 制品 SHA-512")
    expect(releaseNotes).not.toMatch(/未签名|签名状态|生产可信|SmartScreen|Gatekeeper/)
  })

  it("客户端构建不包含 GitHub Token 或可变更新仓库", async () => {
    const updater = await readFile(
      path.join(repository, "client-desktop/src/main/updater-service.ts"),
      "utf8",
    )
    const builder = await readFile(
      path.join(repository, "client-desktop/electron-builder.yml"),
      "utf8",
    )
    expect(`${updater}\n${builder}`).not.toMatch(/GITHUB_TOKEN|GH_TOKEN|Authorization/i)
    expect(updater).toContain("https://github.com/ptonlix/MagicChat/releases")
  })
})
