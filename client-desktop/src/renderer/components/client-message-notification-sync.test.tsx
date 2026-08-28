import { act, render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ClientConversation } from "@/lib/client-data-api"

const {
  callbacks,
  playMessageNotificationSound,
  soundPreference,
  showBrowserMessageNotification,
  showHostMessageNotification,
} = vi.hoisted(() => ({
  callbacks: new Map<string, (payload: unknown) => void>(),
  playMessageNotificationSound: vi.fn(),
  soundPreference: { enabled: true, notificationsEnabled: true },
  showBrowserMessageNotification: vi.fn(() => true),
  showHostMessageNotification: vi.fn(() => true),
}))
let conversations: ClientConversation[] = []

vi.mock("@/lib/realtime-context", () => ({
  useRealtime: () => ({
    subscribeRealtimeEvent: (event: string, callback: (payload: unknown) => void) => {
      callbacks.set(event, callback)
      return () => callbacks.delete(event)
    },
  }),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    contactApps: [],
    contacts: [],
    conversations,
    foregroundConversationId: "",
    me: {
      avatar: "",
      email: "me@example.com",
      id: "user-1",
      name: "Me",
      nickname: "",
    },
  }),
}))

vi.mock("@/lib/message-notification-sound", () => ({
  playMessageNotificationSound,
  prepareMessageNotificationSound: vi.fn(),
}))

vi.mock("@/lib/browser-notifications", () => ({
  getBrowserNotificationPermission: () => "granted",
  showBrowserMessageNotification,
}))

vi.mock("@/lib/desktop-host", () => ({
  isHostMessageNotificationSoundEnabled: () => soundPreference.enabled,
  isHostMessageNotificationsEnabled: () => soundPreference.notificationsEnabled,
  showHostMessageNotification,
}))

import { ClientMessageNotificationSync } from "@/components/client-message-notification-sync"

describe("ClientMessageNotificationSync", () => {
  beforeEach(() => {
    callbacks.clear()
    conversations = []
    soundPreference.enabled = true
    soundPreference.notificationsEnabled = true
    playMessageNotificationSound.mockClear()
    showBrowserMessageNotification.mockClear()
    showHostMessageNotification.mockClear()
  })

  it("suppresses sound and notifications when the event is muted", () => {
    renderNotificationSync()

    act(() => {
      callbacks.get("message.created")?.(createMessageEvent(true))
    })

    expect(playMessageNotificationSound).not.toHaveBeenCalled()
    expect(showHostMessageNotification).not.toHaveBeenCalled()
    expect(showBrowserMessageNotification).not.toHaveBeenCalled()
  })

  it("suppresses sound and notifications when the local conversation is muted", () => {
    conversations = [createConversation({ notificationMuted: true })]
    renderNotificationSync()

    act(() => {
      callbacks.get("message.created")?.(createMessageEvent(false))
    })

    expect(playMessageNotificationSound).not.toHaveBeenCalled()
    expect(showHostMessageNotification).not.toHaveBeenCalled()
    expect(showBrowserMessageNotification).not.toHaveBeenCalled()
  })

  it("plays sound and shows a notification for an ordinary message", () => {
    conversations = [createConversation()]
    renderNotificationSync()

    act(() => {
      callbacks.get("message.created")?.(createMessageEvent(false))
    })

    expect(playMessageNotificationSound).toHaveBeenCalledOnce()
    expect(showHostMessageNotification).toHaveBeenCalledOnce()
  })

  it("keeps desktop notifications when message sound is disabled", () => {
    conversations = [createConversation()]
    soundPreference.enabled = false
    renderNotificationSync()

    act(() => {
      callbacks.get("message.created")?.(createMessageEvent(false))
    })

    expect(playMessageNotificationSound).not.toHaveBeenCalled()
    expect(showHostMessageNotification).toHaveBeenCalledOnce()
  })

  it("suppresses sound and notifications when the master notification switch is disabled", () => {
    conversations = [createConversation()]
    soundPreference.notificationsEnabled = false
    renderNotificationSync()

    act(() => {
      callbacks.get("message.created")?.(createMessageEvent(false))
    })

    expect(playMessageNotificationSound).not.toHaveBeenCalled()
    expect(showHostMessageNotification).not.toHaveBeenCalled()
    expect(showBrowserMessageNotification).not.toHaveBeenCalled()
  })

  it("does not cap host notifications for ordinary conversations", () => {
    const messageCount = 12
    conversations = Array.from({ length: messageCount }, (_, index) =>
      createConversation({ id: `conversation-${index + 1}` }),
    )
    renderNotificationSync()

    act(() => {
      for (let index = 1; index <= messageCount; index += 1) {
        callbacks.get("message.created")?.(createMessageEvent(false, index))
      }
    })

    expect(showHostMessageNotification).toHaveBeenCalledTimes(messageCount)
  })
})

function renderNotificationSync() {
  render(
    <MemoryRouter initialEntries={["/chat"]}>
      <ClientMessageNotificationSync />
    </MemoryRouter>,
  )
}

function createMessageEvent(notificationMuted: boolean, index = 1) {
  return {
    message: {
      body: { content: "新消息", type: "text" },
      client_message_id: `client-message-${index}`,
      conversation_id: `conversation-${index}`,
      created_at: "2026-07-27T00:00:00Z",
      id: `message-${index}`,
      sender: { id: "user-2", type: "user" },
      seq: 1,
    },
    notification_muted: notificationMuted,
  }
}

function createConversation(overrides: Partial<ClientConversation> = {}): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-27T00:00:00Z",
    id: "conversation-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    name: "会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
  }
}
