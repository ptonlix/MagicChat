import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { TopicSourceBanner, TopicSourceMessageSync } from "@/components/conversation/topic-drawer"
import type { ClientMessage, ClientTopicSourceMessage } from "@/lib/client-data-api"
import { applyTopicSourceMessageUpdate } from "@/lib/client-data-state"
import { RealtimeContext } from "@/lib/realtime-context"

vi.mock("@/components/user-profile-popover", () => ({
  UserProfilePopover: ({ children }: { children: ReactNode }) => children,
}))

describe("TopicSourceBanner", () => {
  it("replaces an open source message when it is revoked in realtime", () => {
    const callbacks = new Map<string, (payload: unknown) => void>()
    const onForward = vi.fn()
    const onSetReaction = vi.fn().mockResolvedValue(undefined)

    function Probe() {
      const [source, setSource] = useState(createSourceMessage)
      function handleUpdate(message: ClientMessage) {
        setSource((current) => applyTopicSourceMessageUpdate(current, message))
      }
      return (
        <>
          <TopicSourceMessageSync
            conversationId="conversation-parent"
            messageId={source.id}
            onUpdate={handleUpdate}
          />
          <TopicSourceBanner
            currentUserId="user-2"
            onForward={onForward}
            onSetReaction={onSetReaction}
            reactions={[{ count: 1, reactedByMe: false, text: "👍", users: [] }]}
            sourceMessage={source}
          />
        </>
      )
    }

    render(
      <RealtimeContext.Provider
        value={{
          ready: true,
          sendRealtimeRequest: vi.fn(),
          status: "connected",
          subscribeRealtimeEvent: (event, callback) => {
            callbacks.set(event, callback)
            return () => callbacks.delete(event)
          },
        }}
      >
        <Probe />
      </RealtimeContext.Provider>,
    )

    act(() => {
      callbacks.get("message.updated")?.({
        message: {
          client_message_id: "client-message-1",
          conversation_id: "conversation-parent",
          created_at: "2026-07-20T04:00:00Z",
          id: "message-1",
          revoked_at: "2026-07-28T10:00:00Z",
          revoked_by_user_id: "user-1",
          sender: { id: "user-1", type: "user" },
          seq: 8,
        },
      })
    })

    expect(screen.queryByText("完整来源消息")).not.toBeInTheDocument()
    expect(screen.getByText("该消息已被撤回")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "添加表情" })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId("topic-source-message-bubble"))
    expect(screen.queryByRole("menuitem", { name: "转发" })).not.toBeInTheDocument()
  })

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

    render(<TopicSourceBanner currentUserId="user-2" sourceMessage={sourceMessage} />)

    expect(screen.getByText("完整来源消息")).toBeInTheDocument()
    expect(screen.queryByText("不同的摘要")).not.toBeInTheDocument()
  })

  it("renders and updates reactions on the source message", async () => {
    const onSetReaction = vi.fn().mockResolvedValue(undefined)
    render(
      <TopicSourceBanner
        currentUserId="user-2"
        onSetReaction={onSetReaction}
        reactions={[
          {
            count: 2,
            reactedByMe: true,
            text: "👍",
            users: [
              { id: "user-1", name: "Alice" },
              { id: "user-2", name: "Bob" },
            ],
          },
        ]}
        sourceMessage={createSourceMessage()}
      />,
    )

    const reactionChip = screen.getByRole("button", {
      name: "移除表情 👍",
    })
    const addButton = screen.getByRole("button", { name: "添加表情" })
    const bubbleLine = addButton.closest('[data-slot="message-bubble-line"]')
    expect(bubbleLine).toContainElement(screen.getByTestId("topic-source-message-bubble"))
    expect(screen.getByTestId("topic-source-message-bubble")).toContainElement(reactionChip)

    fireEvent.click(reactionChip)
    await waitFor(() => expect(onSetReaction).toHaveBeenCalledWith("👍", false))
    expect(screen.getByRole("button", { name: "添加表情" })).toBeInTheDocument()
  })

  it("supports forwarding and selecting an available source message", async () => {
    const user = userEvent.setup()
    const onForward = vi.fn()
    const onMultiSelect = vi.fn()
    const onToggleSelected = vi.fn()
    const sourceMessage = createSourceMessage()
    const view = render(
      <TopicSourceBanner
        currentUserId="user-2"
        onForward={onForward}
        onMultiSelect={onMultiSelect}
        onToggleSelected={onToggleSelected}
        sourceMessage={sourceMessage}
      />,
    )

    fireEvent.contextMenu(screen.getByTestId("topic-source-message-bubble"))
    fireEvent.click(screen.getByRole("menuitem", { name: "转发" }))
    expect(onForward).toHaveBeenCalledWith(sourceMessage)

    const moreActions = screen.getByRole("button", { name: "更多操作" })
    expect(moreActions.parentElement).toHaveAttribute("data-slot", "message-hover-actions")
    await user.click(moreActions)
    await user.click(screen.getByRole("menuitem", { name: "多选" }))
    expect(onMultiSelect).toHaveBeenCalledWith(sourceMessage)

    view.rerender(
      <TopicSourceBanner
        currentUserId="user-2"
        onForward={onForward}
        onMultiSelect={onMultiSelect}
        onToggleSelected={onToggleSelected}
        selected
        selectionMode
        sourceMessage={sourceMessage}
      />,
    )
    const checkbox = screen.getByRole("checkbox", { name: "取消选择Alice的消息" })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(onToggleSelected).toHaveBeenCalledWith(sourceMessage)
  })

  it("renders and answers a choice source without exposing message actions", async () => {
    const onRespondToChoice = vi.fn().mockResolvedValue(undefined)
    const sourceMessage = createChoiceSourceMessage()
    render(
      <TopicSourceBanner
        currentUserId="user-2"
        onForward={vi.fn()}
        onMultiSelect={vi.fn()}
        onRespondToChoice={onRespondToChoice}
        sourceChoice={{
          myOptionIds: [],
          options: [
            { id: "project-a", responseCount: 1 },
            { id: "project-b", responseCount: 2 },
          ],
          responseCount: 3,
        }}
        sourceChoiceStatus="active"
        sourceMessage={sourceMessage}
      />,
    )

    expect(screen.queryByText("3 人已回答")).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId("topic-source-message-bubble"))
    expect(screen.queryByRole("menuitem", { name: "转发" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: "项目 B" }))
    fireEvent.click(screen.getByRole("button", { name: "提交" }))
    await waitFor(() => expect(onRespondToChoice).toHaveBeenCalledWith(["project-b"]))
  })

  it("shows choice counts for groups and unavailable source states", () => {
    const sourceMessage = createChoiceSourceMessage()
    const view = render(
      <TopicSourceBanner
        currentUserId="user-2"
        showChoiceResponseCounts
        sourceChoice={{
          myOptionIds: [],
          options: [
            { id: "project-a", responseCount: 1 },
            { id: "project-b", responseCount: 2 },
          ],
          responseCount: 3,
        }}
        sourceChoiceStatus="active"
        sourceMessage={sourceMessage}
      />,
    )
    expect(screen.getByText("1")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()

    view.rerender(
      <TopicSourceBanner
        currentUserId="user-2"
        sourceChoiceStatus="deleted"
        sourceMessage={sourceMessage}
      />,
    )
    expect(screen.getByText("该消息已被删除")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "提交" })).not.toBeInTheDocument()
  })
})

function createSourceMessage(): ClientTopicSourceMessage {
  return {
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
}

function createChoiceSourceMessage(): ClientTopicSourceMessage {
  return {
    ...createSourceMessage(),
    body: {
      content: "请选择项目",
      contentType: "text",
      options: [
        { id: "project-a", label: "项目 A" },
        { id: "project-b", label: "项目 B" },
      ],
      selection: "single",
      type: "choice",
    },
  }
}
