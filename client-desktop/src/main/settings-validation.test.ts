import { describe, expect, it } from "vitest"

import { parseDesktopSettingsPatch } from "@main/settings-validation"

describe("桌面设置 IPC 校验", () => {
  it("接受新消息提示音布尔设置", () => {
    expect(parseDesktopSettingsPatch({ messageSoundEnabled: false })).toEqual({
      messageSoundEnabled: false,
    })
  })

  it("接受新消息通知总开关布尔设置", () => {
    expect(parseDesktopSettingsPatch({ messageNotificationsEnabled: false })).toEqual({
      messageNotificationsEnabled: false,
    })
  })

  it("拒绝非布尔的新消息通知总开关设置", () => {
    expect(() => parseDesktopSettingsPatch({ messageNotificationsEnabled: "false" })).toThrow(
      "新消息通知设置无效",
    )
  })

  it("拒绝未知设置字段", () => {
    expect(() => parseDesktopSettingsPatch({ unknown: true })).toThrow("设置字段无效")
  })

  it("拒绝非布尔的新消息提示音设置", () => {
    expect(() => parseDesktopSettingsPatch({ messageSoundEnabled: "false" })).toThrow(
      "新消息提示音设置无效",
    )
  })

  it("拒绝通过通用设置接口选择服务器", () => {
    expect(() => parseDesktopSettingsPatch({ selectedServerId: "server-1" })).toThrow(
      "设置字段无效",
    )
  })

  it("拒绝无效的关闭行为和通知隐私设置", () => {
    expect(() => parseDesktopSettingsPatch({ closeBehavior: "hide" })).toThrow("关闭行为设置无效")
    expect(() => parseDesktopSettingsPatch({ notificationPrivacy: "full" })).toThrow(
      "通知隐私设置无效",
    )
  })
})
