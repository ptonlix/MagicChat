import { describe, expect, it } from "vitest"

import conversationInfoDrawerSource from "../components/conversation-info-drawer.tsx?raw"
import conversationPanelSource from "../components/conversation-panel.tsx?raw"
import directConversationInfoSource from "../components/direct-conversation-info.tsx?raw"
import { formatConversationLastMessageTime } from "@/lib/conversation-format"

describe("chat page copy", () => {
  it("uses 私聊 instead of 单聊 for direct conversations", () => {
    const source = [
      conversationPanelSource,
      conversationInfoDrawerSource,
      directConversationInfoSource,
    ].join("\n")

    expect(source).toContain("私聊")
    expect(source).not.toContain("单聊")
  })
})

describe("formatConversationLastMessageTime", () => {
  const now = new Date("2026-07-03T20:00:00")

  it("shows HH:mm for messages from the same day", () => {
    expect(
      formatConversationLastMessageTime("2026-07-03T16:05:00", now)
    ).toBe("16:05")
  })

  it("shows MM-dd for messages from another day", () => {
    expect(
      formatConversationLastMessageTime("2026-07-02T16:05:00", now)
    ).toBe("07-02")
  })

  it("returns empty text when no valid time is available", () => {
    expect(formatConversationLastMessageTime(null, now)).toBe("")
    expect(formatConversationLastMessageTime("not-a-date", now)).toBe("")
  })
})
