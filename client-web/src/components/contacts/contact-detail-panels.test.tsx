import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ContactDetailPanel } from "@/components/contacts/contact-detail-panels"
import type { ContactUser } from "@/lib/client-data-api"

const contact: ContactUser = {
  avatar: "",
  email: "me@example.com",
  id: "current-user",
  lastOnlineAt: null,
  name: "Me",
  nickname: "",
  online: true,
  phone: "",
  type: "user",
}

describe("ContactDetailPanel", () => {
  it("does not render a message action for the current user", () => {
    render(
      <ContactDetailPanel
        canStartConversation={false}
        contact={contact}
        onStartConversation={vi.fn()}
        startingConversation={false}
      />
    )

    expect(
      screen.queryByRole("button", { name: "发消息" })
    ).not.toBeInTheDocument()
  })

  it("renders a message action for another contact", () => {
    render(
      <ContactDetailPanel
        canStartConversation
        contact={{ ...contact, id: "other-user" }}
        onStartConversation={vi.fn()}
        startingConversation={false}
      />
    )

    expect(screen.getByRole("button", { name: "发消息" })).toBeInTheDocument()
  })
})
