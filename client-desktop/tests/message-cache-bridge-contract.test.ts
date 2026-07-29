// @vitest-environment node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")

describe("消息缓存 Bridge 安全边界", () => {
  it("Shared、Preload 和 Main 注册同一组窄类型操作", async () => {
    const [bridge, preload, mainIpc] = await Promise.all([
      readFile(path.join(root, "src/shared/bridge.ts"), "utf8"),
      readFile(path.join(root, "src/preload/index.ts"), "utf8"),
      readFile(path.join(root, "src/main/ipc.ts"), "utf8"),
    ])
    for (const operation of [
      "ClearConversation",
      "CommitAfter",
      "CommitBefore",
      "CommitLatest",
      "GetSyncState",
      "ReadBefore",
      "ReadRecent",
      "Upsert",
    ]) {
      expect(bridge).toContain(`messageCache${operation}`)
      expect(preload).toContain(`IPC.messageCache${operation}`)
      expect(mainIpc).toContain(`IPC.messageCache${operation}`)
    }
  })

  it("Preload 不暴露 SQL、数据库路径、Worker 或通用 channel", async () => {
    const preload = await readFile(path.join(root, "src/preload/index.ts"), "utf8")
    expect(preload).not.toMatch(/node:sqlite|DatabaseSync|message-cache-worker|\.sqlite3/)
    expect(preload).not.toContain("ipcRenderer.invoke(channel")
  })

  it("DatabaseSync 仅出现在消息缓存 Worker 可达的存储模块", async () => {
    const [main, service, store] = await Promise.all([
      readFile(path.join(root, "src/main/index.ts"), "utf8"),
      readFile(path.join(root, "src/main/message-cache/message-cache-service.ts"), "utf8"),
      readFile(path.join(root, "src/main/message-cache/message-cache-store.ts"), "utf8"),
    ])
    expect(main).not.toContain("DatabaseSync")
    expect(service).not.toContain("DatabaseSync")
    expect(store).toContain('from "node:sqlite"')
  })
})
