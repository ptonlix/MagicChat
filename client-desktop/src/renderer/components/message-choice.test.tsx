import userEvent from "@testing-library/user-event"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { MessageBodyRenderer, MessageBubble } from "@/components/conversation/conversation-message"
import { MessageChoice } from "@/components/message-choice"
import type { ClientConversation } from "@/lib/client-data-api"
import type { ConversationPanelMessage } from "@/lib/conversation-panel-types"

vi.mock("@/components/user-profile-popover", () => ({
  UserProfilePopover: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/app-profile-popover", () => ({
  AppProfilePopover: ({ children }: { children: ReactNode }) => children,
}))

describe("choice message", () => {
  it("renders the choice content and options", () => {
    render(
      <MessageBodyRenderer
        body={{
          content: "**动物投票**",
          contentType: "markdown",
          options: [
            { id: "lion", label: "🦁 狮子" },
            { id: "tiger", label: "🐯 老虎" },
          ],
          selection: "multiple",
          type: "choice",
        }}
        currentUserId="user-1"
        mentionLabelResolver={() => undefined}
      />,
    )

    expect(screen.getByText("动物投票")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "🦁 狮子" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: "🐯 老虎" })).toBeDisabled()
  })

  it("renders mention tokens in plain-text choice content as readable names", () => {
    render(
      <MessageBodyRenderer
        body={{
          content: "{(@user/d192d0f5-67b3-47d1-a8b7-3a23aacba570)} 文怡是哪里人？",
          contentType: "text",
          options: [
            { id: "chengdu", label: "成都" },
            { id: "chongqing", label: "重庆" },
          ],
          selection: "single",
          type: "choice",
        }}
        currentUserId="user-1"
        mentionLabelResolver={(target) =>
          target.id === "d192d0f5-67b3-47d1-a8b7-3a23aacba570" ? "朱莉" : undefined
        }
      />,
    )

    expect(screen.getByText("@朱莉 文怡是哪里人？")).toBeInTheDocument()
    expect(screen.queryByText(/\{\(@user\//)).not.toBeInTheDocument()
  })

  it("shows response counts from the message choice state", () => {
    render(
      <MessageBodyRenderer
        body={{
          content: "动物投票",
          contentType: "text",
          options: [
            { id: "lion", label: "🦁 狮子" },
            { id: "tiger", label: "🐯 老虎" },
          ],
          selection: "multiple",
          type: "choice",
        }}
        choice={{
          myOptionIds: [],
          options: [
            { id: "lion", responseCount: 2 },
            { id: "tiger", responseCount: 1 },
          ],
          responseCount: 3,
        }}
        currentUserId="user-1"
        mentionLabelResolver={() => undefined}
      />,
    )

    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("marks the choice as voted after a successful submission", async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)

    render(
      <MessageChoice
        body={{
          content: "动物投票",
          contentType: "text",
          options: [
            { id: "lion", label: "🦁 狮子" },
            { id: "tiger", label: "🐯 老虎" },
          ],
          selection: "multiple",
          type: "choice",
        }}
        currentUserId="user-1"
        mentionLabelResolver={() => undefined}
        onRespond={onRespond}
      />,
    )

    await user.click(screen.getByRole("checkbox", { name: "🦁 狮子" }))
    await user.click(screen.getByRole("button", { name: "提交" }))

    expect(await screen.findByRole("button", { name: "已投票" })).toBeDisabled()
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("checkbox", { name: "🦁 狮子" })).toBeDisabled()
  })

  it("updates the selected option when the message choice snapshot changes", () => {
    const body = {
      content: "动物投票",
      contentType: "text" as const,
      options: [
        { id: "lion", label: "🦁 狮子" },
        { id: "tiger", label: "🐯 老虎" },
      ],
      selection: "multiple" as const,
      type: "choice" as const,
    }
    const message = createChoiceMessage(body)
    const conversation = {
      id: "conversation-1",
      name: "Alice",
      type: "direct",
    } as ClientConversation
    const mentionLabelResolver = () => undefined
    const onInsertMention = vi.fn()
    const onRespondToChoice = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <MessageBubble
        conversation={conversation}
        currentUserId="user-1"
        mentionLabelResolver={mentionLabelResolver}
        message={message}
        onInsertMention={onInsertMention}
        onRespondToChoice={onRespondToChoice}
      />,
    )

    expect(screen.getByRole("checkbox", { name: "🦁 狮子" })).not.toBeChecked()

    rerender(
      <MessageBubble
        conversation={conversation}
        currentUserId="user-1"
        mentionLabelResolver={mentionLabelResolver}
        message={{
          ...message,
          choice: {
            myOptionIds: ["lion"],
            options: [
              { id: "lion", responseCount: 1 },
              { id: "tiger", responseCount: 0 },
            ],
            responseCount: 1,
          },
        }}
        onInsertMention={onInsertMention}
        onRespondToChoice={onRespondToChoice}
      />,
    )

    expect(screen.getByRole("checkbox", { name: "🦁 狮子" })).toBeChecked()
  })
})

function createChoiceMessage(
  body: Extract<ConversationPanelMessage["body"], { type: "choice" }>,
): ConversationPanelMessage {
  return {
    author: "Alice",
    avatar: "",
    body,
    canRevoke: false,
    choice: {
      myOptionIds: [],
      options: [
        { id: "lion", responseCount: 0 },
        { id: "tiger", responseCount: 0 },
      ],
      responseCount: 0,
    },
    createdAt: "2026-07-27T00:00:00Z",
    delegatedByName: "",
    id: "message-1",
    mentionTarget: null,
    reactionVersion: 0,
    reactions: [],
    role: "other",
    senderAppId: null,
    senderAppProfile: null,
    senderUserId: "user-2",
    time: "08:00",
  }
}
