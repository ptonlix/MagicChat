import { describe, expect, it } from "vitest"

import { parseDesktopSettingsPatch } from "@main/settings-validation"

describe("桌面设置 IPC 校验", () => {
  it("接受新消息提示音布尔设置", () => {
    expect(parseDesktopSettingsPatch({ messageSoundEnabled: false })).toEqual({
      messageSoundEnabled: false,
    })
  })

  it("拒绝未知设置字段", () => {
    expect(() => parseDesktopSettingsPatch({ unknown: true })).toThrow("设置字段无效")
  })

  it("拒绝非布尔的新消息提示音设置", () => {
    expect(() => parseDesktopSettingsPatch({ messageSoundEnabled: "false" })).toThrow(
      "新消息提示音设置无效",
    )
  })
})
