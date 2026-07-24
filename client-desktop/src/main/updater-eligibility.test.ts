import { describe, expect, it } from "vitest"
import { determineUpdateEligibility } from "@main/updater-eligibility"

describe("更新资格判定", () => {
  it.each([
    ["win32", "x64", undefined, "ota", "nsis", true],
    ["win32", "arm64", undefined, "ota", "nsis", true],
    ["darwin", "x64", undefined, "ota", "mac_app", true],
    ["darwin", "arm64", undefined, "ota", "mac_app", true],
    ["linux", "x64", "/tmp/MagicChat.AppImage", "ota", "appimage", true],
    ["linux", "arm64", undefined, "manual", "deb", true],
  ] as const)(
    "%s/%s Stable 安装来源返回 %s",
    (platform, arch, appImagePath, mode, source, canCheck) => {
      expect(
        determineUpdateEligibility({
          appImagePath,
          arch,
          channel: "stable",
          packaged: true,
          platform,
        }),
      ).toEqual({ canCheck, installationSource: source, mode })
    },
  )

  it("开发、test 和不支持架构不连接 Stable 更新源", () => {
    expect(
      determineUpdateEligibility({
        arch: "x64",
        channel: "stable",
        packaged: false,
        platform: "win32",
      }),
    ).toMatchObject({ canCheck: false, mode: "manual" })
    expect(
      determineUpdateEligibility({
        arch: "x64",
        channel: "test",
        packaged: true,
        platform: "win32",
      }),
    ).toMatchObject({ canCheck: false, mode: "manual" })
    expect(
      determineUpdateEligibility({
        arch: "ia32",
        channel: "stable",
        packaged: true,
        platform: "win32",
      }),
    ).toMatchObject({ canCheck: false, mode: "unsupported" })
  })
})
