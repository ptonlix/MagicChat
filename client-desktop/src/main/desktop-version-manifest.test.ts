// @vitest-environment node

import { describe, expect, it } from "vitest"
import {
  compareStableVersions,
  desktopVersionKey,
  selectDesktopVersionEntry,
} from "@main/desktop-version-manifest"

const manifest = {
  windows: { build: 8, version: "1.8.0", url: "https://example.com/MagicChat.exe" },
  macos: { build: 8, version: "1.8.0", url: "https://example.com/MagicChat.dmg" },
  "linux-amd": {
    build: 8,
    version: "1.8.0",
    url: "https://example.com/MagicChat-x86_64.AppImage",
  },
  "linux-arm": {
    build: 8,
    version: "1.8.0",
    url: "https://example.com/MagicChat-arm64.AppImage",
  },
}

describe("桌面 version.json", () => {
  it.each([
    ["win32", "x64", "windows"],
    ["darwin", "x64", "macos"],
    ["darwin", "arm64", "macos"],
    ["linux", "x64", "linux-amd"],
    ["linux", "arm64", "linux-arm"],
    ["win32", "arm64", undefined],
  ] as const)("映射 %s/%s 到 %s", (platform, arch, key) => {
    expect(desktopVersionKey(platform, arch)).toBe(key)
  })

  it("读取当前平台字段并拒绝不安全元数据", () => {
    expect(selectDesktopVersionEntry(manifest, "win32", "x64")).toEqual(manifest.windows)
    expect(() =>
      selectDesktopVersionEntry(
        { ...manifest, windows: { ...manifest.windows, url: "http://example.com/MagicChat.exe" } },
        "win32",
        "x64",
      ),
    ).toThrow("url")
    expect(() =>
      selectDesktopVersionEntry(
        { ...manifest, windows: { ...manifest.windows, version: "1.8.0-beta.1" } },
        "win32",
        "x64",
      ),
    ).toThrow("version")
  })

  it("只按 Stable SemVer 判断升级与降级", () => {
    expect(compareStableVersions("1.10.0", "1.9.9")).toBe(1)
    expect(compareStableVersions("1.8.0", "1.8.0")).toBe(0)
    expect(compareStableVersions("1.7.9", "1.8.0")).toBe(-1)
    expect(() => compareStableVersions("1.8.0-beta.1", "1.8.0")).toThrow()
  })
})
