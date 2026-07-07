import { act, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientDataProvider } from "@/components/client-data-provider"
import { useClientData } from "@/lib/client-data-context"
import { type ClientMessage } from "@/lib/client-data-api"

function createSuccessResponse(data: unknown) {
  return new Response(
    JSON.stringify({
      success: true,
      data,
    }),
    {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    }
  )
}

function createMeResponse(name = "Alice Zhang") {
  return createSuccessResponse({
    user: {
      avatar: "/assets/avatars/builtin/17.webp",
      created_at: "2026-07-01T12:34:56Z",
      email: "alice@example.com",
      id: "user-1",
      name,
      nickname: "Al",
      phone: "+8613912345678",
      status: "active",
    },
  })
}

function createContactsResponse(name = "Bob Li") {
  return createSuccessResponse({
    apps: [
      {
        avatar: "/assets/apps/assistant.webp",
        description: "专属 AI 助理",
        id: "app-1",
        name: "AI 女菩萨",
        online: false,
        type: "app",
      },
    ],
    groups: [
      {
        avatar: "",
        id: "conversation-public-1",
        joined: false,
        member_count: 8,
        name: "公开群",
        type: "group",
        visibility: "public",
      },
    ],
    users: [
      {
        avatar: "/assets/avatars/builtin/03.webp",
        email: "bob@example.com",
        id: "user-2",
        name,
        nickname: "",
        phone: "+8613912345679",
        type: "user",
      },
    ],
  })
}

function createConversationsResponse(name = "Bob Li") {
  return createSuccessResponse({
    conversations: [
      {
        avatar: "/assets/avatars/builtin/03.webp",
        created_at: "2026-07-03T07:00:00Z",
        id: "conversation-1",
        last_message_at: "2026-07-03T08:00:00Z",
        last_message_id: "message-1",
        last_message_seq: 12,
        last_message_summary: "好的，我看一下",
        member_count: 2,
        name,
        type: "direct",
      },
    ],
  })
}

function createDirectConversationResponse() {
  return createSuccessResponse({
    conversation: {
      avatar: "/assets/avatars/builtin/05.webp",
      created_at: "2026-07-03T09:00:00Z",
      id: "conversation-2",
      last_message_at: null,
      last_message_id: null,
      last_message_seq: 0,
      last_message_summary: "",
      member_count: 2,
      name: "Carol Wang",
      type: "direct",
    },
    created: true,
  })
}

function createAppConversationResponse() {
  return createSuccessResponse({
    conversation: {
      avatar: "/assets/apps/assistant.webp",
      created_at: "2026-07-03T09:10:00Z",
      id: "conversation-app-1",
      last_message_at: null,
      last_message_id: null,
      last_message_seq: 0,
      last_message_summary: "",
      member_count: 2,
      name: "AI 女菩萨",
      type: "app",
    },
    created: true,
  })
}

function createGroupConversationResponse() {
  return createSuccessResponse({
    conversation: {
      created_at: "2026-07-03T09:30:00Z",
      created_by_user_id: "user-1",
      id: "conversation-3",
      member_count: 2,
      members: [
        {
          avatar: "/assets/avatars/builtin/17.webp",
          email: "alice@example.com",
          id: "user-1",
          name: "Alice Zhang",
          nickname: "Al",
          phone: "+8613912345678",
          role: "owner",
        },
        {
          avatar: "/assets/avatars/builtin/03.webp",
          email: "bob@example.com",
          id: "user-2",
          name: "Bob Li",
          nickname: "",
          phone: "+8613912345679",
          role: "member",
        },
      ],
      name: "新品讨论组",
      posting_policy: "open",
      status: "active",
      type: "group",
    },
  })
}

function createGroupActionResponse({
  conversationId = "conversation-public-1",
  name = "公开群",
  visibility = "public",
}: {
  conversationId?: string
  name?: string
  visibility?: "private" | "public"
} = {}) {
  return createSuccessResponse({
    conversation: {
      avatar: "",
      created_at: "2026-07-03T09:30:00Z",
      id: conversationId,
      last_message_at: null,
      last_message_id: null,
      last_message_seq: 1,
      last_message_summary: "",
      member_count: 3,
      name,
      type: "group",
      visibility,
    },
    message: {
      body: {
        actor: {
          display_name: "Alice Zhang",
          id: "user-1",
        },
        event:
          visibility === "public"
            ? "group_visibility_changed"
            : "group_member_joined",
        type: "system_event",
        visibility,
      },
      client_message_id: "",
      conversation_id: conversationId,
      created_at: "2026-07-03T09:31:00Z",
      id: `message-${conversationId}`,
      sender: {
        type: "system",
      },
      seq: 1,
    },
  })
}

function createClientMessage({
  content,
  seq,
}: {
  content: string
  seq: number
}): ClientMessage {
  return {
    body: {
      content,
      type: "text",
    },
    clientMessageId: `client-message-${seq}`,
    conversationId: "conversation-1",
    createdAt: `2026-07-03T08:${String(seq).padStart(2, "0")}:00Z`,
    id: `message-${seq}`,
    sender: {
      id: "user-2",
      type: "user",
    },
    seq,
  }
}

function createClientDataFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)

    if (path === "/api/client/me") {
      return createMeResponse()
    }

    if (path === "/api/client/contacts") {
      return createContactsResponse()
    }

    if (path === "/api/client/conversations") {
      return createConversationsResponse()
    }

    if (
      path === "/api/client/conversations/direct" &&
      init?.method === "POST"
    ) {
      return createDirectConversationResponse()
    }

    if (path === "/api/client/conversations/apps" && init?.method === "POST") {
      return createAppConversationResponse()
    }

    if (
      path === "/api/client/conversations/groups" &&
      init?.method === "POST"
    ) {
      return createGroupConversationResponse()
    }

    if (
      path === "/api/client/conversations/groups/conversation-public-1/join" &&
      init?.method === "POST"
    ) {
      return createGroupActionResponse()
    }

    if (
      path === "/api/client/conversations/groups/conversation-1/public" &&
      init?.method === "POST"
    ) {
      return createGroupActionResponse({
        conversationId: "conversation-1",
        name: "Bob Li",
        visibility: "public",
      })
    }

    return new Response(null, { status: 404 })
  })
}

function createClientDataErrorFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)

    if (path === "/api/client/me") {
      return createMeResponse()
    }

    if (path === "/api/client/contacts") {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "internal_error",
            message: "通讯录加载失败",
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 500,
        }
      )
    }

    if (path === "/api/client/conversations") {
      return createConversationsResponse()
    }

    return new Response(null, { status: 404 })
  })
}

function DataProbe() {
  const {
    contactApps,
    contactGroups,
    conversations,
    contacts,
    contactsRefreshing,
    createGroupConversation,
    joinGroupConversation,
    me,
    meRefreshing,
    openAppConversation,
    openDirectConversation,
    refreshContacts,
    refreshMe,
    setGroupConversationPublic,
    updateConversationLastMessage,
  } = useClientData()

  return (
    <div>
      <span data-testid="me-name">{me.name}</span>
      <span data-testid="contact-app-count">{contactApps.length}</span>
      <span data-testid="contact-group-count">{contactGroups.length}</span>
      <span data-testid="contact-count">{contacts.length}</span>
      <span data-testid="conversation-count">{conversations.length}</span>
      <span data-testid="first-conversation-name">
        {conversations[0]?.name ?? ""}
      </span>
      <span data-testid="first-conversation-summary">
        {conversations[0]?.lastMessageSummary ?? ""}
      </span>
      <span data-testid="first-conversation-seq">
        {String(conversations[0]?.lastMessageSeq ?? "")}
      </span>
      <span data-testid="me-refreshing">{String(meRefreshing)}</span>
      <span data-testid="contacts-refreshing">
        {String(contactsRefreshing)}
      </span>
      <button type="button" onClick={() => void refreshMe()}>
        refresh me
      </button>
      <button type="button" onClick={() => void refreshContacts()}>
        refresh contacts
      </button>
      <button
        type="button"
        onClick={() => void openDirectConversation("user-3")}
      >
        open direct
      </button>
      <button type="button" onClick={() => void openAppConversation("app-1")}>
        open app
      </button>
      <button
        type="button"
        onClick={() =>
          void createGroupConversation("新品讨论组", ["user-2"])
        }
      >
        create group
      </button>
      <button
        type="button"
        onClick={() => void joinGroupConversation("conversation-public-1")}
      >
        join group
      </button>
      <button
        type="button"
        onClick={() => void setGroupConversationPublic("conversation-1")}
      >
        set public
      </button>
      <button
        type="button"
        onClick={() =>
          updateConversationLastMessage(
            createClientMessage({ content: "更新后的新消息", seq: 13 })
          )
        }
      >
        update newest message
      </button>
      <button
        type="button"
        onClick={() =>
          updateConversationLastMessage(
            createClientMessage({ content: "延迟到达的旧消息", seq: 11 })
          )
        }
      >
        update stale message
      </button>
    </div>
  )
}

function renderProvider() {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <ClientDataProvider>
        <DataProbe />
      </ClientDataProvider>
    </MemoryRouter>
  )
}

async function flushBootstrapPromises() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
  }
}

describe("ClientDataProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", createClientDataFetchMock())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("keeps the loading page visible for at least two seconds", async () => {
    vi.useFakeTimers()
    renderProvider()

    expect(screen.getByText("正在为你加载数据")).toBeInTheDocument()
    const progressbar = screen.getByRole("progressbar")

    expect(progressbar).toBeInTheDocument()
    expect(progressbar.firstElementChild).toHaveClass(
      "client-loading-progress-indicator"
    )
    expect(screen.queryByTestId("me-name")).not.toBeInTheDocument()

    await act(async () => {
      await flushBootstrapPromises()
    })

    expect(screen.getByText("正在为你加载数据")).toBeInTheDocument()
    expect(screen.queryByTestId("me-name")).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1_999)
      await flushBootstrapPromises()
    })

    expect(screen.getByText("正在为你加载数据")).toBeInTheDocument()
    expect(screen.queryByTestId("me-name")).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await flushBootstrapPromises()
    })

    expect(screen.getByTestId("me-name")).toHaveTextContent("Alice Zhang")
    expect(screen.getByTestId("contact-app-count")).toHaveTextContent("1")
    expect(screen.getByTestId("contact-group-count")).toHaveTextContent("1")
    expect(screen.getByTestId("contact-count")).toHaveTextContent("1")
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("1")
    expect(screen.queryByText("正在为你加载数据")).not.toBeInTheDocument()
  })

  it("refreshes me and contacts independently every minute", async () => {
    vi.useFakeTimers()
    const fetcher = fetch as unknown as ReturnType<typeof vi.fn>
    renderProvider()

    await act(async () => {
      await flushBootstrapPromises()
      vi.advanceTimersByTime(2_000)
      await flushBootstrapPromises()
    })
    expect(screen.getByTestId("me-name")).toHaveTextContent("Alice Zhang")
    fetcher.mockClear()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetcher).toHaveBeenCalledWith("/api/client/me", {
      credentials: "include",
      method: "GET",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/client/contacts", {
      credentials: "include",
      method: "GET",
    })
    expect(fetcher).not.toHaveBeenCalledWith("/api/client/conversations", {
      credentials: "include",
      method: "GET",
    })
  })

  it("opens an app conversation and prepends it to conversations", async () => {
    vi.useFakeTimers()
    const fetcher = fetch as unknown as ReturnType<typeof vi.fn>
    renderProvider()

    await act(async () => {
      await flushBootstrapPromises()
      vi.advanceTimersByTime(2_000)
      await flushBootstrapPromises()
    })

    fetcher.mockClear()

    await act(async () => {
      screen.getByRole("button", { name: "open app" }).click()
      await flushBootstrapPromises()
    })

    expect(fetcher).toHaveBeenCalledWith("/api/client/conversations/apps", {
      body: JSON.stringify({
        app_id: "app-1",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("2")
    expect(screen.getByTestId("first-conversation-name")).toHaveTextContent(
      "AI 女菩萨"
    )
  })

  it("opens a direct conversation and prepends it to conversations", async () => {
    vi.useFakeTimers()
    const fetcher = fetch as unknown as ReturnType<typeof vi.fn>
    renderProvider()

    await act(async () => {
      await flushBootstrapPromises()
      vi.advanceTimersByTime(2_000)
      await flushBootstrapPromises()
    })

    expect(screen.getByTestId("conversation-count")).toHaveTextContent("1")
    fetcher.mockClear()

    await act(async () => {
      screen.getByRole("button", { name: "open direct" }).click()
      await flushBootstrapPromises()
    })

    expect(fetcher).toHaveBeenCalledWith("/api/client/conversations/direct", {
      body: JSON.stringify({
        user_id: "user-3",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("2")
    expect(screen.getByTestId("first-conversation-name")).toHaveTextContent(
      "Carol Wang"
    )
  })

  it("creates a group conversation and prepends it to conversations", async () => {
    vi.useFakeTimers()
    const fetcher = fetch as unknown as ReturnType<typeof vi.fn>
    renderProvider()

    await act(async () => {
      await flushBootstrapPromises()
      vi.advanceTimersByTime(2_000)
      await flushBootstrapPromises()
    })

    expect(screen.getByTestId("conversation-count")).toHaveTextContent("1")
    fetcher.mockClear()

    await act(async () => {
      screen.getByRole("button", { name: "create group" }).click()
      await flushBootstrapPromises()
    })

    expect(fetcher).toHaveBeenCalledWith("/api/client/conversations/groups", {
      body: JSON.stringify({
        member_ids: ["user-2"],
        name: "新品讨论组",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("2")
    expect(screen.getByTestId("first-conversation-name")).toHaveTextContent(
      "新品讨论组"
    )
  })

  it("joins a public group and refreshes contacts", async () => {
    vi.useFakeTimers()
    const fetcher = fetch as unknown as ReturnType<typeof vi.fn>
    renderProvider()

    await act(async () => {
      await flushBootstrapPromises()
      vi.advanceTimersByTime(2_000)
      await flushBootstrapPromises()
    })

    fetcher.mockClear()

    await act(async () => {
      screen.getByRole("button", { name: "join group" }).click()
      await flushBootstrapPromises()
    })

    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/groups/conversation-public-1/join",
      {
        credentials: "include",
        method: "POST",
      }
    )
    expect(fetcher).toHaveBeenCalledWith("/api/client/contacts", {
      credentials: "include",
      method: "GET",
    })
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("2")
    expect(screen.getByTestId("first-conversation-name")).toHaveTextContent(
      "公开群"
    )
  })

  it("sets a group public and refreshes contacts", async () => {
    vi.useFakeTimers()
    const fetcher = fetch as unknown as ReturnType<typeof vi.fn>
    renderProvider()

    await act(async () => {
      await flushBootstrapPromises()
      vi.advanceTimersByTime(2_000)
      await flushBootstrapPromises()
    })

    fetcher.mockClear()

    await act(async () => {
      screen.getByRole("button", { name: "set public" }).click()
      await flushBootstrapPromises()
    })

    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/groups/conversation-1/public",
      {
        credentials: "include",
        method: "POST",
      }
    )
    expect(fetcher).toHaveBeenCalledWith("/api/client/contacts", {
      credentials: "include",
      method: "GET",
    })
  })

  it("does not let stale message pushes regress conversation summary", async () => {
    vi.useFakeTimers()
    renderProvider()

    await act(async () => {
      await flushBootstrapPromises()
      vi.advanceTimersByTime(2_000)
      await flushBootstrapPromises()
    })

    await act(async () => {
      screen.getByRole("button", { name: "update newest message" }).click()
    })

    expect(screen.getByTestId("first-conversation-summary")).toHaveTextContent(
      "更新后的新消息"
    )
    expect(screen.getByTestId("first-conversation-seq")).toHaveTextContent(
      "13"
    )

    await act(async () => {
      screen.getByRole("button", { name: "update stale message" }).click()
    })

    expect(screen.getByTestId("first-conversation-summary")).toHaveTextContent(
      "更新后的新消息"
    )
    expect(screen.getByTestId("first-conversation-seq")).toHaveTextContent(
      "13"
    )
  })

  it("uses the shared button component for bootstrap retry", async () => {
    vi.stubGlobal("fetch", createClientDataErrorFetchMock())
    renderProvider()

    expect(
      await screen.findByText("工作区加载失败", undefined, {
        timeout: 3_000,
      })
    ).toBeInTheDocument()
    const retryButton = screen.getByRole("button", { name: "重试" })

    expect(retryButton).toHaveAttribute("data-slot", "button")
    expect(retryButton).toHaveAttribute("data-variant", "outline")
  })
})
