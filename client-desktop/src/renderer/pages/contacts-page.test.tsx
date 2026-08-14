import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { ContactsPage } from "@/pages/contacts-page"
import { defaultAppInfo } from "@/lib/app-info"
import { AppInfoContext } from "@/lib/app-info-context"
import { ClientDataRequestError, type ClientUser, type ContactUser } from "@/lib/client-data-api"
import { ClientDataContext, type ClientDataContextValue } from "@/lib/client-data-context"

const mocks = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }))

vi.mock("@/components/locale-provider", async () => {
  const { translate } = await import("@/lib/i18n")
  return {
    useLocale: () => ({
      t: (key: string, params?: Record<string, string | number>) =>
        translate("zh-CN", key as never, params),
    }),
  }
})

vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }))

describe("ContactsPage", () => {
  it("保留好友授权失败的服务端文案且不导航到伪造私信", async () => {
    const user = userEvent.setup()
    mocks.toastError.mockReset()
    const error = new ClientDataRequestError("仅支持向好友发送私信", {
      code: "direct_friendship_required",
      status: 403,
    })
    const openDirectConversation = vi.fn().mockRejectedValue(error)

    render(
      <AppInfoContext.Provider
        value={{ ...defaultAppInfo, organizationName: "测试组织", setAuthenticated: vi.fn() }}
      >
        <ClientDataContext.Provider value={createClientDataValue(openDirectConversation)}>
          <MemoryRouter initialEntries={["/contacts"]}>
            <Routes>
              <Route
                element={
                  <>
                    <ContactsPage />
                    <LocationProbe />
                  </>
                }
                path="/contacts"
              />
            </Routes>
          </MemoryRouter>
        </ClientDataContext.Provider>
      </AppInfoContext.Provider>,
    )

    await user.click(screen.getByRole("button", { name: "与 Bob 对话" }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(error.message))
    expect(openDirectConversation).toHaveBeenCalledWith("user-2")
    expect(screen.getByTestId("contacts-location")).toHaveTextContent("/contacts")
  })

  it("与 Web 一致地在非好友资料页创建好友申请", async () => {
    const user = userEvent.setup()
    const createFriendRequest = vi.fn().mockResolvedValue(undefined)
    mocks.toastSuccess.mockReset()

    render(
      <AppInfoContext.Provider
        value={{ ...defaultAppInfo, organizationName: "测试组织", setAuthenticated: vi.fn() }}
      >
        <ClientDataContext.Provider
          value={createClientDataValue(vi.fn(), {
            contacts: [],
            createFriendRequest,
            ensureUsers: vi.fn().mockResolvedValue(undefined),
            usersById: { "user-2": nonFriend },
          })}
        >
          <MemoryRouter initialEntries={["/contacts/user/user-2"]}>
            <Routes>
              <Route element={<ContactsPage />} path="/contacts/:directoryType/:directoryId" />
            </Routes>
          </MemoryRouter>
        </ClientDataContext.Provider>
      </AppInfoContext.Provider>,
    )

    await user.click(await screen.findByRole("button", { name: "添加好友" }))

    await waitFor(() => expect(createFriendRequest).toHaveBeenCalledWith("user-2"))
    expect(mocks.toastSuccess).toHaveBeenCalledWith("好友申请已发送")
    expect(screen.queryByRole("button", { name: "发消息" })).not.toBeInTheDocument()
  })

  it("与 Web 一致地在发出申请后显示等待状态", async () => {
    const createFriendRequest = vi.fn()

    render(
      <AppInfoContext.Provider
        value={{ ...defaultAppInfo, organizationName: "测试组织", setAuthenticated: vi.fn() }}
      >
        <ClientDataContext.Provider
          value={createClientDataValue(vi.fn(), {
            contacts: [],
            createFriendRequest,
            ensureUsers: vi.fn().mockResolvedValue(undefined),
            outgoingFriendRequests: [
              {
                addresseeUserId: "user-2",
                createdAt: "2026-08-14T00:00:00Z",
                handledAt: null,
                id: "request-1",
                requesterUserId: "user-1",
                status: "pending",
                updatedAt: "2026-08-14T00:00:00Z",
              },
            ],
            usersById: { "user-2": nonFriend },
          })}
        >
          <MemoryRouter initialEntries={["/contacts/user/user-2"]}>
            <Routes>
              <Route element={<ContactsPage />} path="/contacts/:directoryType/:directoryId" />
            </Routes>
          </MemoryRouter>
        </ClientDataContext.Provider>
      </AppInfoContext.Provider>,
    )

    expect(await screen.findByRole("button", { name: "等待对方接受" })).toBeDisabled()
    expect(createFriendRequest).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "发消息" })).not.toBeInTheDocument()
  })
})

function LocationProbe() {
  return <output data-testid="contacts-location">{useLocation().pathname}</output>
}

const nonFriend: ContactUser = {
  avatar: "",
  email: "bob@example.com",
  id: "user-2",
  lastOnlineAt: null,
  name: "Bob",
  nickname: "",
  online: true,
  phone: "",
  type: "user",
}

function createClientDataValue(
  openDirectConversation: ClientDataContextValue["openDirectConversation"],
  overrides: Partial<ClientDataContextValue> = {},
): ClientDataContextValue {
  const me: ClientUser = {
    avatar: "",
    createdAt: "2026-08-01T00:00:00Z",
    email: "alice@example.com",
    id: "user-1",
    lastOnlineAt: null,
    name: "Alice",
    nickname: "",
    phone: "",
    status: "active",
  }
  return {
    contactApps: [],
    contactDirectoryMode: "friends",
    contactGroups: [],
    contacts: [nonFriend],
    contactsError: null,
    contactsLoading: false,
    contactsRefreshing: false,
    conversations: [],
    me,
    meError: null,
    meLoading: false,
    meRefreshing: false,
    personalProject: {},
    projects: [],
    projectsError: null,
    projectsLoading: false,
    projectsLoadingMore: false,
    projectsNextCursor: null,
    projectsRefreshing: false,
    createProject: vi.fn(),
    ensureConversationMessages: vi.fn(),
    getConversation: vi.fn(() => null),
    getConversationMessageState: vi.fn(),
    clearMessageScope: vi.fn(),
    loadBeforeConversationMessages: vi.fn(),
    loadAfterConversationMessages: vi.fn(),
    focusConversationMessage: vi.fn(),
    consumeConversationMessageFocus: vi.fn(),
    replaceWithLatestMessages: vi.fn(),
    markConversationRead: vi.fn(),
    setConversationPinned: vi.fn(),
    setConversationMuted: vi.fn(),
    handleIncomingConversationMessage: vi.fn(),
    handleIncomingConversationMessageUpdate: vi.fn(),
    handleIncomingMessageReactionsUpdate: vi.fn(),
    updateConversationLastMentionedSeq: vi.fn(),
    mergeIncomingConversationMessage: vi.fn(),
    openDirectConversation,
    openAppConversation: vi.fn(),
    restoreConversation: vi.fn(),
    joinGroupConversation: vi.fn(),
    leaveGroupConversation: vi.fn(),
    removeConversation: vi.fn(),
    removeGroupConversationMember: vi.fn(),
    revokeConversationMessage: vi.fn(),
    setMessageReaction: vi.fn(),
    setGroupConversationPublic: vi.fn(),
    setGroupConversationPrivate: vi.fn(),
    updateGroupConversationName: vi.fn(),
    updateGroupConversationAnnouncement: vi.fn(),
    refreshConversations: vi.fn(),
    refreshContacts: vi.fn().mockResolvedValue("friends"),
    refreshFriendData: vi.fn(),
    refreshMe: vi.fn(),
    refreshProjects: vi.fn(),
    loadMoreProjects: vi.fn(),
    sendConversationText: vi.fn(),
    sendConversationMarkdown: vi.fn(),
    sendConversationLink: vi.fn(),
    sendConversationCard: vi.fn(),
    sendConversationFile: vi.fn(),
    sendConversationImage: vi.fn(),
    sendConversationVoice: vi.fn(),
    syncLoadedConversationMessages: vi.fn(),
    updateConversationLastMessage: vi.fn(),
    updateConversationPinned: vi.fn(),
    updateConversationMuted: vi.fn(),
    updateGroupConversationAvatar: vi.fn(),
    ...overrides,
  } as unknown as ClientDataContextValue
}
