// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { FileDocumentWindowStateStore } from "./document-window-state"

describe("FileDocumentWindowStateStore", () => {
  let directory = ""

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-document-window-"))
  })

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  it("按认证目标和文档键持久化 bounds，不保存正文或凭据", async () => {
    const store = new FileDocumentWindowStateStore(directory)
    const state = {
      bounds: { height: 760, width: 1120, x: 24, y: 32 },
      displayId: "display-1",
    }
    await store.set("server-1:user-1:document-1", state)

    const returned = store.get("server-1:user-1:document-1")
    expect(returned).toEqual(state)
    if (!returned) throw new Error("窗口状态未保存")
    ;(returned as unknown as { bounds: { x: number } }).bounds.x = 999
    expect(store.get("server-1:user-1:document-1")?.bounds.x).toBe(24)

    const raw = await readFile(path.join(directory, "document-window-state.json"), "utf8")
    expect(raw).toContain('"server-1:user-1:document-1"')
    expect(raw).not.toContain("正文")
    expect(raw).not.toContain("token")

    const reopened = new FileDocumentWindowStateStore(directory)
    await reopened.load()
    expect(reopened.get("server-1:user-1:document-1")).toEqual(state)
  })

  it("损坏状态只回退为空状态并隔离坏文件，非法记录不会进入内存", async () => {
    await writeFile(path.join(directory, "document-window-state.json"), "{bad", "utf8")
    const store = new FileDocumentWindowStateStore(directory)
    await store.load()

    expect(store.get("server-1:user-1:document-1")).toBeUndefined()
    const files = await readdir(directory)
    expect(files.some((file) => file.startsWith("document-window-state.json.invalid-"))).toBe(true)

    await writeFile(
      path.join(directory, "document-window-state.json"),
      JSON.stringify({
        bad: { bounds: { height: 1, width: 1, x: 0, y: 0 }, displayId: { secret: true } },
      }),
      "utf8",
    )
    const invalid = new FileDocumentWindowStateStore(directory)
    await invalid.load()
    expect(invalid.get("bad")).toBeUndefined()
  })

  it("串行写入并支持删除，避免快速移动窗口时覆盖有效状态", async () => {
    const store = new FileDocumentWindowStateStore(directory)
    await Promise.all([
      store.set("target:document-1", { bounds: { height: 760, width: 1120, x: 10, y: 10 } }),
      store.set("target:document-2", { bounds: { height: 600, width: 800, x: 20, y: 20 } }),
    ])
    expect(store.get("target:document-1")).toBeDefined()
    expect(store.get("target:document-2")).toBeDefined()

    await store.delete("target:document-1")
    expect(store.get("target:document-1")).toBeUndefined()
    expect(store.get("target:document-2")).toBeDefined()
  })
})
