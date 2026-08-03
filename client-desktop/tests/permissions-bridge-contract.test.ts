// @vitest-environment node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")

describe("权限设置 Bridge 安全边界", () => {
  it("Shared、Preload 和 Main 只暴露固定权限设置操作", async () => {
    const [bridge, preload, mainIpc] = await Promise.all([
      readFile(path.join(root, "src/shared/bridge.ts"), "utf8"),
      readFile(path.join(root, "src/preload/index.ts"), "utf8"),
      readFile(path.join(root, "src/main/ipc.ts"), "utf8"),
    ])

    expect(bridge).toContain("permissionsOpenSettings")
    expect(preload).toContain("IPC.permissionsOpenSettings")
    expect(mainIpc).toContain("IPC.permissionsOpenSettings")
    expect(bridge).toContain('openSettings(kind: "screen")')
    expect(mainIpc).toContain('if (kind !== "screen")')
    expect(preload).not.toContain("x-apple.systempreferences")
  })
})
