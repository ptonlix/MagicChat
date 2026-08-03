// @vitest-environment node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")

describe("全局截图快捷键错误提示契约", () => {
  it("通过只读 Bridge 事件通知 Renderer 且不再打开原生消息框", async () => {
    const [bridge, preload, main] = await Promise.all([
      readFile(path.join(root, "src/shared/bridge.ts"), "utf8"),
      readFile(path.join(root, "src/preload/index.ts"), "utf8"),
      readFile(path.join(root, "src/main/index.ts"), "utf8"),
    ])

    expect(bridge).toContain('screenshotStartFailed: "desktop:v1:screenshot-start-failed"')
    expect(preload).toContain("subscribeStartFailed")
    expect(preload).toContain("IPC.screenshotStartFailed")
    expect(main).toContain("windows.send(IPC.screenshotStartFailed")

    const shortcutStart = main.indexOf("const screenshotShortcut =")
    const shortcutEnd = main.indexOf("const cancelScreenshotForDisplayChange", shortcutStart)
    const shortcutSource = main.slice(shortcutStart, shortcutEnd)
    expect(shortcutSource).not.toContain("dialog.showMessageBox")
  })
})
