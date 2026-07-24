import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")

describe("Updater Bridge 契约", () => {
  it("共享契约、Preload 和 Main 注册保持一致", async () => {
    const [bridge, preload, ipc] = await Promise.all([
      readFile(path.join(root, "src/shared/bridge.ts"), "utf8"),
      readFile(path.join(root, "src/preload/index.ts"), "utf8"),
      readFile(path.join(root, "src/main/ipc.ts"), "utf8"),
    ])
    for (const name of [
      "updaterCheck",
      "updaterDownload",
      "updaterInstall",
      "updaterOpenManual",
      "updaterState",
    ]) {
      expect(bridge).toContain(name)
      expect(preload).toContain(`IPC.${name}`)
      expect(ipc).toContain(`IPC.${name}`)
    }
  })

  it("所有 invoke handler 统一经过可信发送方校验", async () => {
    const ipc = await readFile(path.join(root, "src/main/ipc.ts"), "utf8")
    expect(ipc).toContain("assertTrustedIpcSender(event)")
    expect(ipc).toContain("ipcMain.handle(channel")
    expect(ipc).not.toMatch(/ipcMain\.handle\(IPC\.updater/)
  })
})
