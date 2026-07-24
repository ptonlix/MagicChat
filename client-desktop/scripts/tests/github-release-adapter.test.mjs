import { describe, expect, it } from "vitest"
import { releaseAssetUploadArguments } from "../github-release-adapter.mjs"

describe("GitHub Release 适配器", () => {
  it("使用 uploads.github.com 完整 URL 上传 Release Asset", () => {
    const args = releaseAssetUploadArguments({
      filePath: "/tmp/MagicChat Desktop.deb",
      id: 359210329,
      name: "MagicChat Desktop.deb",
      repository: "ptonlix/MagicChat",
    })
    expect(args).toEqual([
      "--method",
      "POST",
      "-H",
      "Content-Type: application/octet-stream",
      "--input",
      "/tmp/MagicChat Desktop.deb",
      "https://uploads.github.com/repos/ptonlix/MagicChat/releases/359210329/assets?name=MagicChat%20Desktop.deb",
    ])
    expect(args).not.toContain("--hostname")
    expect(args.join(" ")).not.toContain("api.uploads.github.com")
  })
})
