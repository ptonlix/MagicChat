import { describe, expect, it } from "vitest"
import { BRIDGE_VERSION, IPC } from "../src/shared/bridge"

describe("Desktop Bridge 契约", () => {
  it("使用显式版本和唯一 IPC channel", () => {
    expect(BRIDGE_VERSION).toBe(1)
    const channels = Object.values(IPC)
    expect(new Set(channels).size).toBe(channels.length)
    expect(channels.every((channel) => channel.startsWith("desktop:v1:"))).toBe(true)
  })

  it("序列化边界不暴露原始 Electron channel", () => {
    expect(Object.keys(IPC)).not.toContain("ipcRenderer")
    expect(JSON.parse(JSON.stringify({ version: BRIDGE_VERSION }))).toEqual({ version: 1 })
  })
})
