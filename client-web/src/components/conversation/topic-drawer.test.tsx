import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { TopicSourceBanner } from "@/components/conversation/topic-drawer"
import type { ClientTopicSourceMessage } from "@/lib/client-data-api"

describe("TopicSourceBanner", () => {
  it("renders the preserved source body instead of reducing it to its summary", () => {
    const sourceMessage: ClientTopicSourceMessage = {
      body: { content: "完整来源消息", type: "text" },
      createdAt: "2026-07-20T04:00:00Z",
      id: "message-1",
      revokedAt: null,
      sender: {
        avatar: "/avatars/alice.webp",
        id: "user-1",
        name: "Alice",
        type: "user",
      },
      seq: 8,
      summary: "不同的摘要",
    }

    render(
      <TopicSourceBanner currentUserId="user-2" sourceMessage={sourceMessage} />
    )

    expect(screen.getByText("完整来源消息")).toBeInTheDocument()
    expect(screen.queryByText("不同的摘要")).not.toBeInTheDocument()
    expect(screen.getByTestId("topic-source-message-bubble")).toHaveClass(
      "bg-zinc-100"
    )
  })
})
