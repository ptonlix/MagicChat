import { describe, expect, it } from "vitest"
import { createDesktopVersionFile, validateVersionFile } from "../desktop-version-file.mjs"

const sha512 = Buffer.alloc(64, 0x5a).toString("base64")
const integrity = {
  windows: { sha512, size: 101 },
  macos: { sha512, size: 102 },
  "linux-amd": { sha512, size: 103 },
  "linux-arm": { sha512, size: 104 },
}

const base = {
  android: { build: 10, version: "1.4.0", url: "https://jiying.chat/releases/jiying.apk" },
  ios: { build: 1, version: "1.0.0", url: "https://jiying.chat/releases/jiying.dmg" },
  windows: { build: 1, version: "1.0.0", url: "https://jiying.chat/releases/jiying.exe" },
  macos: { build: 1, version: "1.0.0", url: "https://jiying.chat/releases/jiying.dmg" },
  "linux-amd": {
    build: 1,
    version: "1.0.0",
    url: "https://jiying.chat/releases/jiying.amd.AppImage",
  },
  "linux-arm": {
    build: 1,
    version: "1.0.0",
    url: "https://jiying.chat/releases/jiying.arm.AppImage",
  },
}

describe("桌面发布 version.json", () => {
  it("保留移动端字段并生成带实际完整性元数据的 GitHub Release 全量包地址", () => {
    const result = createDesktopVersionFile(base, {
      build: 18,
      integrity,
      tag: "desktop-v1.8.0",
      version: "1.8.0",
    })
    expect(result.android).toEqual(base.android)
    expect(result.ios).toEqual(base.ios)
    expect(result.windows).toEqual({
      build: 18,
      sha512,
      size: 101,
      version: "1.8.0",
      url: "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.8.0-win-x64.exe",
    })
    expect(result["linux-arm"].url).toContain("Jiying-1.8.0-linux-arm64.AppImage")
  })

  it("缺少移动端字段、完整性元数据或字段不合法时终止生成", () => {
    const missingIos = structuredClone(base)
    delete missingIos.ios
    expect(() => validateVersionFile(missingIos)).toThrow("ios")
    expect(() => validateVersionFile({ ...base, android: { ...base.android, build: 0 } })).toThrow(
      "正整数",
    )
    expect(() =>
      createDesktopVersionFile(base, {
        build: 18,
        integrity,
        tag: "desktop-v1.8.1",
        version: "1.8.0",
      }),
    ).toThrow("不匹配")
    expect(() =>
      createDesktopVersionFile(base, {
        build: 18,
        integrity: { ...integrity, windows: { size: 101 } },
        tag: "desktop-v1.8.0",
        version: "1.8.0",
      }),
    ).toThrow("sha512")
    const generated = createDesktopVersionFile(base, {
      build: 18,
      integrity,
      tag: "desktop-v1.8.0",
      version: "1.8.0",
    })
    expect(() =>
      validateVersionFile({
        ...generated,
        windows: { ...generated.windows, url: "https://evil.example/Jiying-1.8.0-win-x64.exe" },
      }),
    ).toThrow("受信任")
  })
})
