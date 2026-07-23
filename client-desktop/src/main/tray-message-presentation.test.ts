import { describe, expect, it } from "vitest"

import { presentTrayMessage } from "@main/tray-message-presentation"
import type { TrayMessage } from "@shared/bridge"

const message: TrayMessage = {
  conversationId: "conversation-1",
  name: "机密项目讨论组",
  serverId: "server-1",
  summary: "**发布计划** <strong>周五上线</strong>",
  unreadCount: 3,
}

describe("presentTrayMessage", () => {
  it("完全隐藏时不暴露会话名和正文", () => {
    expect(presentTrayMessage(message, "hidden")).toEqual({
      label: "新消息  [3]",
      sublabel: "你收到了一条新消息",
    })
  })

  it("元数据模式只展示会话名", () => {
    expect(presentTrayMessage(message, "metadata")).toEqual({
      label: "机密项目讨论组  [3]",
      sublabel: "有新消息",
    })
  })

  it("预览模式展示清理后的正文并限制未读徽标", () => {
    expect(presentTrayMessage({ ...message, unreadCount: 100 }, "preview")).toEqual({
      label: "机密项目讨论组  [99+]",
      sublabel: "发布计划 周五上线",
    })
  })
})
