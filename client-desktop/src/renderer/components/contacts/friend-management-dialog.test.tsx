import { render, screen, waitFor, within } from "@testing-library/react"
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

  it("仅保留搜索控件，不显示额外说明或空搜索提示", () => {
    renderDialog()

    expect(screen.getByRole("searchbox", { name: "精确查找用户" })).toBeInTheDocument()
    expect(
      screen.queryByText("使用完整邮箱、手机号或用户 ID 精确查找用户。"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("输入完整信息查找用户")).not.toBeInTheDocument()
  })

  it("按更新时间合并申请历史并显示方向和终态", () => {
    const alice = createUser("user-1", "Alice")
    const bob = createUser("user-2", "Bob")
    const carol = createUser("user-3", "Carol")
    const dave = createUser("user-4", "Dave")

    renderDialog({
      currentUserId: alice.id,
      incomingRequests: [
        createRequest("request-in-pending", bob.id, alice.id, "pending", "2026-08-12T10:00:00Z"),
        createRequest(
          "request-in-accepted",
          carol.id,
          alice.id,
          "accepted",
          "2026-08-10T10:00:00Z",
        ),
      ],
      outgoingRequests: [
        createRequest(
          "request-out-rejected",
          alice.id,
          dave.id,
          "rejected",
          "2026-08-11T10:00:00Z",
        ),
      ],
      usersById: { [alice.id]: alice, [bob.id]: bob, [carol.id]: carol, [dave.id]: dave },
    })

    const history = screen.getByRole("region", { name: "申请记录" })
    const content = history.textContent ?? ""
    expect(content.indexOf("Bob")).toBeLessThan(content.indexOf("Dave"))
    expect(content.indexOf("Dave")).toBeLessThan(content.indexOf("Carol"))
    expect(within(history).getAllByText("请求添加你为好友")).toHaveLength(2)
    expect(within(history).getByText("你发出了好友申请")).toBeInTheDocument()
    expect(within(history).getByText("待处理")).toBeInTheDocument()
    expect(within(history).getByText("已拒绝")).toBeInTheDocument()
    expect(within(history).getByText("已接受")).toBeInTheDocument()
  })

  it("只对待处理的对应方向申请提供操作", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const bob = createUser("user-2", "Bob")
    const carol = createUser("user-3", "Carol")
    const dave = createUser("user-4", "Dave")
    const acceptRequest = vi.fn().mockResolvedValue(undefined)
    const cancelRequest = vi.fn().mockResolvedValue(undefined)
    const rejectRequest = vi.fn().mockResolvedValue(undefined)

    renderDialog({
      acceptRequest,
      cancelRequest,
      currentUserId: alice.id,
      incomingRequests: [
        createRequest("request-in", bob.id, alice.id, "pending", "2026-08-12T10:00:00Z"),
        createRequest("request-done", carol.id, alice.id, "accepted", "2026-08-10T10:00:00Z"),
      ],
      outgoingRequests: [
        createRequest("request-out", alice.id, dave.id, "pending", "2026-08-11T10:00:00Z"),
      ],
      rejectRequest,
      usersById: { [alice.id]: alice, [bob.id]: bob, [carol.id]: carol, [dave.id]: dave },
    })

    await user.click(screen.getByRole("button", { name: "接受" }))
    await waitFor(() => expect(acceptRequest).toHaveBeenCalledWith("request-in"))
    await user.click(screen.getByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(rejectRequest).toHaveBeenCalledWith("request-in"))
    await user.click(screen.getByRole("button", { name: "取消申请" }))
    await waitFor(() => expect(cancelRequest).toHaveBeenCalledWith("request-out"))
    expect(screen.queryByText("Carol")).toBeInTheDocument()
  })

  it("精确搜索隐藏本人，并只将好友和 pending 关系禁用", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const bob = createUser("user-2", "Bob")
    const carol = createUser("user-3", "Carol")
    const dave = createUser("user-4", "Dave")
    const ensureUsers = vi.fn().mockResolvedValue(undefined)
    const createRequest = vi.fn().mockResolvedValue(undefined)
    friendApiMocks.searchContactUsers.mockResolvedValue([alice.id, bob.id, carol.id, dave.id])

    renderDialog({
      contacts: [alice, bob],
      createRequest,
      currentUserId: alice.id,
      ensureUsers,
      incomingRequests: [
        createRequestData("request-in", carol.id, alice.id, "pending", "2026-08-12T10:00:00Z"),
      ],
      outgoingRequests: [
        createRequestData("request-out", alice.id, dave.id, "canceled", "2026-08-11T10:00:00Z"),
      ],
      usersById: { [alice.id]: alice, [bob.id]: bob, [carol.id]: carol, [dave.id]: dave },
    })

    await user.type(screen.getByRole("searchbox", { name: "精确查找用户" }), "dave@example.com")
    await user.click(screen.getByRole("button", { name: "查找" }))

    await waitFor(() =>
      expect(friendApiMocks.searchContactUsers).toHaveBeenCalledWith("dave@example.com"),
    )
    expect(ensureUsers).toHaveBeenCalledWith([alice.id, bob.id, carol.id, dave.id])
    expect(screen.queryByText("Alice")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "已是好友" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "申请处理中" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "添加好友" }))
    await waitFor(() => expect(createRequest).toHaveBeenCalledWith(dave.id))
  })

  it("支持键盘提交精确搜索，并以可访问错误呈现搜索失败", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const bob = createUser("user-2", "Bob")
    friendApiMocks.searchContactUsers.mockResolvedValueOnce([bob.id])

    const view = renderDialog({
      currentUserId: alice.id,
      ensureUsers: vi.fn().mockResolvedValue(undefined),
      usersById: { [alice.id]: alice, [bob.id]: bob },
    })
    const searchbox = screen.getByRole("searchbox", { name: "精确查找用户" })
    searchbox.focus()
    expect(searchbox).toHaveFocus()
    await user.type(searchbox, "bob@example.com")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(friendApiMocks.searchContactUsers).toHaveBeenCalledOnce())
    expect(screen.getByText("Bob")).toBeInTheDocument()

    view.unmount()
    friendApiMocks.searchContactUsers.mockRejectedValueOnce(new Error("查询服务暂不可用"))
    renderDialog()
    const failedSearchbox = screen.getByRole("searchbox", { name: "精确查找用户" })
    failedSearchbox.focus()
    await user.type(failedSearchbox, "bob@example.com")
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("alert")).toHaveTextContent("查找用户失败")
  })

  it("失败后恢复待处理操作，且不保留旧入口", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const bob = createUser("user-2", "Bob")
    const rejectRequest = vi.fn().mockRejectedValue(new Error("请求失败"))

    renderDialog({
      currentUserId: alice.id,
      incomingRequests: [
        createRequest("request-in", bob.id, alice.id, "pending", "2026-08-12T10:00:00Z"),
      ],
      rejectRequest,
      usersById: { [alice.id]: alice, [bob.id]: bob },
    })

    const rejectButton = screen.getByRole("button", { name: "拒绝" })
    await user.click(rejectButton)
    await waitFor(() => expect(rejectRequest).toHaveBeenCalledWith("request-in"))
    expect(rejectButton).toBeEnabled()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "查看资料" })).not.toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[calc(100svh-2rem)]")
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
  status: FriendRequest["status"],
  updatedAt: string,
) {
  return createRequestData(id, requesterUserId, addresseeUserId, status, updatedAt)
}

function createRequestData(
  id: string,
  requesterUserId: string,
  addresseeUserId: string,
  status: FriendRequest["status"],
  updatedAt: string,
): FriendRequest {
  return {
    addresseeUserId,
    createdAt: updatedAt,
    handledAt: status === "pending" ? null : updatedAt,
    id,
    requesterUserId,
    status,
    updatedAt,
  }
}
