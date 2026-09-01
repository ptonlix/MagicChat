import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { readDesktopReleaseBuild } from "../release-build.mjs"

describe("Desktop release build", () => {
  it("从 version base 读取四个平台一致的正整数 build", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jiying-release-build-"))
    const filePath = path.join(directory, "release-version-base.json")
    await writeFile(filePath, desktopVersionBase(2))

    await expect(readDesktopReleaseBuild(filePath)).resolves.toBe(2)
  })

  it("拒绝缺失、非整数和非正数", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jiying-release-build-invalid-"))
    for (const [name, contents] of [
      ["missing", "{}"],
      ["string", desktopVersionBase("2")],
      ["zero", desktopVersionBase(0)],
      ["fraction", desktopVersionBase(2.5)],
    ]) {
      const filePath = path.join(directory, `${name}.json`)
      await writeFile(filePath, contents)
      await expect(readDesktopReleaseBuild(filePath)).rejects.toThrow("正整数")
    }
  })

  it("拒绝四个 Desktop 平台 build 不一致", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jiying-release-build-mismatch-"))
    const filePath = path.join(directory, "release-version-base.json")
    const value = JSON.parse(desktopVersionBase(2))
    value.macos.build = 3
    await writeFile(filePath, JSON.stringify(value))

    await expect(readDesktopReleaseBuild(filePath)).rejects.toThrow("必须一致")
  })
})

function desktopVersionBase(build) {
  return JSON.stringify({
    windows: { build },
    macos: { build },
    "linux-amd": { build },
    "linux-arm": { build },
  })
}
