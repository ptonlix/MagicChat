import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { FriendManagementDialog } from "@/components/contacts/friend-management-dialog"
import type { ContactUser, FriendRequest } from "@/lib/client-data-api"

const friendApiMocks = vi.hoisted(() => ({ searchContactUsers: vi.fn() }))

vi.mock("@/lib/client-data-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-data-api")>()),
  searchContactUsers: friendApiMocks.searchContactUsers,
}))

describe("FriendManagementDialog", () => {
  beforeEach(() => friendApiMocks.searchContactUsers.mockReset())

  it("handles incoming, outgoing, and established relationships", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const bob = createUser("user-2", "Bob")
    const carol = createUser("user-3", "Carol")
    const dave = createUser("user-4", "Dave")
    const acceptRequest = vi.fn().mockResolvedValue(undefined)
    const cancelRequest = vi.fn().mockResolvedValue(undefined)
    const deleteFriend = vi.fn().mockResolvedValue(undefined)
    const rejectRequest = vi.fn().mockResolvedValue(undefined)

    renderDialog({
      acceptRequest,
      cancelRequest,
      contacts: [alice, bob],
      currentUserId: alice.id,
      deleteFriend,
      incomingRequests: [createRequest("request-in", carol.id, alice.id)],
      outgoingRequests: [createRequest("request-out", alice.id, dave.id)],
      rejectRequest,
      usersById: { [alice.id]: alice, [bob.id]: bob, [carol.id]: carol, [dave.id]: dave },
    })

    await user.click(screen.getByRole("button", { name: "删除" }))
    expect(deleteFriend).toHaveBeenCalledWith(bob.id)

    await user.click(screen.getByRole("tab", { name: /收到/ }))
    await user.click(screen.getByRole("button", { name: "接受" }))
    expect(acceptRequest).toHaveBeenCalledWith("request-in")
    await user.click(screen.getByRole("button", { name: "拒绝" }))
    expect(rejectRequest).toHaveBeenCalledWith("request-in")

    await user.click(screen.getByRole("tab", { name: /发出/ }))
    await user.click(screen.getByRole("button", { name: "取消申请" }))
    expect(cancelRequest).toHaveBeenCalledWith("request-out")
  })

  it("resolves exact search results, excludes self, and creates a request", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const dave = createUser("user-4", "Dave")
    const ensureUsers = vi.fn().mockResolvedValue(undefined)
    const createRequest = vi.fn().mockResolvedValue(undefined)
    friendApiMocks.searchContactUsers.mockResolvedValue([alice.id, dave.id])

    renderDialog({
      contacts: [alice],
      createRequest,
      currentUserId: alice.id,
      ensureUsers,
      usersById: { [alice.id]: alice, [dave.id]: dave },
    })

    await user.click(screen.getByRole("tab", { name: "添加" }))
    await user.type(screen.getByRole("textbox", { name: "精确查找用户" }), "dave@example.com")
    await user.click(screen.getByRole("button", { name: "查找" }))

    await waitFor(() =>
      expect(friendApiMocks.searchContactUsers).toHaveBeenCalledWith("dave@example.com"),
    )
    expect(ensureUsers).toHaveBeenCalledWith([alice.id, dave.id])
    expect(screen.queryByText("Alice")).not.toBeInTheDocument()

    await user.click(await screen.findByRole("button", { name: "添加好友" }))
    expect(createRequest).toHaveBeenCalledWith(dave.id)
  })

  it("opens a searched non-friend profile", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const dave = createUser("user-4", "Dave")
    const onSelectUser = vi.fn()
    friendApiMocks.searchContactUsers.mockResolvedValue([dave.id])

    renderDialog({
      contacts: [alice],
      currentUserId: alice.id,
      onSelectUser,
      usersById: { [alice.id]: alice, [dave.id]: dave },
    })

    await user.click(screen.getByRole("tab", { name: "添加" }))
    await user.type(screen.getByRole("textbox", { name: "精确查找用户" }), "dave@example.com")
    await user.click(screen.getByRole("button", { name: "查找" }))
    await user.click(await screen.findByRole("button", { name: "查看资料" }))

    expect(onSelectUser).toHaveBeenCalledWith(dave.id)
  })
})

function renderDialog(props: Partial<ComponentProps<typeof FriendManagementDialog>> = {}) {
  return render(
    <FriendManagementDialog
      acceptRequest={vi.fn().mockResolvedValue(undefined)}
      cancelRequest={vi.fn().mockResolvedValue(undefined)}
      contacts={[]}
      createRequest={vi.fn().mockResolvedValue(undefined)}
      currentUserId="user-1"
      deleteFriend={vi.fn().mockResolvedValue(undefined)}
      ensureUsers={vi.fn().mockResolvedValue(undefined)}
      incomingRequests={[]}
      onOpenChange={vi.fn()}
      open
      outgoingRequests={[]}
      rejectRequest={vi.fn().mockResolvedValue(undefined)}
      usersById={{}}
      {...props}
    />,
  )
}

function createUser(id: string, name: string): ContactUser {
  return {
    avatar: "",
    email: `${name.toLowerCase()}@example.com`,
    id,
    lastOnlineAt: null,
    name,
    nickname: "",
    online: false,
    phone: "",
    type: "user",
  }
}

function createRequest(
  id: string,
  requesterUserId: string,
  addresseeUserId: string,
): FriendRequest {
  return {
    addresseeUserId,
    createdAt: "2026-08-11T00:00:00Z",
    handledAt: null,
    id,
    requesterUserId,
    status: "pending",
    updatedAt: "2026-08-11T00:00:00Z",
  }
}
