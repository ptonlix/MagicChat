import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const updaterEntry = require.resolve("electron-updater")
const updaterRoot = path.dirname(updaterEntry)
const { Provider, findFile, parseUpdateInfo, resolveFiles } = require(
  path.join(updaterRoot, "providers/Provider.js"),
)
const fixture = await readFile(
  path.join(import.meta.dirname, "fixtures/windows-latest.yml"),
  "utf8",
)

describe("electron-updater Windows Provider 回归", () => {
  it("固定使用 electron-updater 6.8.9 和默认 latest.yml", () => {
    const packageJson = require("electron-updater/package.json")
    expect(packageJson.version).toBe("6.8.9")
    const provider = new TestProvider()
    expect(provider.getDefaultChannelName()).toBe("latest")
    expect(`${provider.getDefaultChannelName()}.yml`).toBe("latest.yml")
  })

  it.each(["x64", "arm64"])("为 %s 选择唯一匹配架构的 NSIS", (arch) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "arch")
    Object.defineProperty(process, "arch", { configurable: true, value: arch })
    try {
      const updateInfo = parseUpdateInfo(
        fixture,
        "latest.yml",
        new URL("https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.2.3/latest.yml"),
      )
      const files = resolveFiles(
        updateInfo,
        new URL("https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.2.3/"),
      )
      expect(findFile(files, "exe").info.url).toBe(`MagicChat-1.2.3-win-${arch}.exe`)
    } finally {
      if (descriptor) Object.defineProperty(process, "arch", descriptor)
    }
  })
})

class TestProvider extends Provider {
  constructor() {
    super({ executor: { request: () => Promise.resolve(null) }, platform: "win32" })
  }
}
