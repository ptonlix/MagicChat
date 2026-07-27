import userEvent from "@testing-library/user-event"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { MessageBodyRenderer } from "@/components/conversation/conversation-message"
import { MessageChoice } from "@/components/message-choice"

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
})
