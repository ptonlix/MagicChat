import { ClientDataRequestError, createRequestError, normalizeVisibility, readJson } from "./core"
import type {
  ClientDataFetch,
  ClientDataSuccessEnvelope,
  ClientDataErrorEnvelope,
  ClientUserResponse,
  CurrentClientUserResponse,
  UploadCurrentClientAvatarResponse,
  UpdateCurrentClientUserInput,
  ContactUserResponse,
  ListClientContactsResponse,
  ResolveClientUsersResponse,
  ContactAppResponse,
  ContactGroupResponse,
  ClientUser,
  ContactUser,
  ContactApp,
  ContactGroup,
  ContactGroupAvatarMember,
  FriendRequest,
  FriendRequestResponse,
  ListFriendRequestsResponse,
  ResolvedClientUser,
  SearchContactUsersResponse,
} from "./types"

export async function getCurrentClientUser(fetcher: ClientDataFetch = fetch) {
  const response = await fetcher("/api/client/me", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<CurrentClientUserResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载当前用户失败")
  }

  const user = (payload as ClientDataSuccessEnvelope<CurrentClientUserResponse> | undefined)?.data
    ?.user

  return normalizeClientUser(user)
}

export async function updateCurrentClientUser(
  input: UpdateCurrentClientUserInput,
  fetcher: ClientDataFetch = fetch,
) {
  const response = await fetcher("/api/client/me", {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<CurrentClientUserResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "更新个人信息失败")
  }

  const user = (payload as ClientDataSuccessEnvelope<CurrentClientUserResponse> | undefined)?.data
    ?.user

  return normalizeClientUser(user)
}

export async function uploadCurrentClientAvatar(file: File, fetcher: ClientDataFetch = fetch) {
  const formData = new FormData()
  formData.set("file", file)

  const response = await fetcher("/api/client/me/avatar", {
    body: formData,
    credentials: "include",
    method: "POST",
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<UploadCurrentClientAvatarResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "上传头像失败")
  }

  const user = (payload as ClientDataSuccessEnvelope<UploadCurrentClientAvatarResponse> | undefined)
    ?.data?.user

  return normalizeClientUser(user)
}

export async function resolveClientUsers(
  userIds: readonly string[],
  fetcher: ClientDataFetch = fetch,
  signal?: AbortSignal,
): Promise<ResolvedClientUser[]> {
  if (userIds.length === 0 || userIds.length > 100 || userIds.some((userId) => !userId.trim())) {
    throw new ClientDataRequestError("用户资料请求格式不正确")
  }
  const response = await fetcher("/api/client/users/resolve", {
    body: JSON.stringify({ user_ids: userIds }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<ResolveClientUsersResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载用户资料失败")
  }
  const users = (payload as ClientDataSuccessEnvelope<ResolveClientUsersResponse> | undefined)?.data
    ?.users
  if (!Array.isArray(users)) {
    throw new ClientDataRequestError("用户资料响应格式不正确")
  }
  return users.map((user) => {
    if (typeof user?.updated_at !== "string" || !isValidDate(user.updated_at)) {
      throw new ClientDataRequestError("用户资料响应格式不正确")
    }
    return { ...normalizeContactUser(user), updatedAt: user.updated_at }
  })
}

export async function searchContactUsers(
  query: string,
  fetcher: ClientDataFetch = fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher("/api/client/users/search", {
    body: JSON.stringify({ query }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<SearchContactUsersResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "查找用户失败")
  }
  const userIds = (payload as ClientDataSuccessEnvelope<SearchContactUsersResponse> | undefined)
    ?.data?.user_ids
  if (!Array.isArray(userIds) || userIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new ClientDataRequestError("用户查找响应格式不正确")
  }
  return [...new Set(userIds)]
}

export async function listFriendRequests(
  direction: "incoming" | "outgoing",
  fetcher: ClientDataFetch = fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher(`/api/client/friend-requests?direction=${direction}`, {
    credentials: "include",
    method: "GET",
    signal,
  })
  return readFriendRequestList(response, "加载好友申请失败")
}

export function createFriendRequest(userId: string, fetcher: ClientDataFetch = fetch) {
  return mutateFriendRequest(
    "/api/client/friend-requests",
    "POST",
    { user_id: requireFriendIdentifier(userId) },
    fetcher,
  )
}

export function acceptFriendRequest(requestId: string, fetcher: ClientDataFetch = fetch) {
  return mutateFriendRequest(
    `/api/client/friend-requests/${encodeURIComponent(requireFriendIdentifier(requestId))}/accept`,
    "POST",
    undefined,
    fetcher,
  )
}

export function rejectFriendRequest(requestId: string, fetcher: ClientDataFetch = fetch) {
  return mutateFriendRequest(
    `/api/client/friend-requests/${encodeURIComponent(requireFriendIdentifier(requestId))}/reject`,
    "POST",
    undefined,
    fetcher,
  )
}

export function cancelFriendRequest(requestId: string, fetcher: ClientDataFetch = fetch) {
  return mutateFriendRequest(
    `/api/client/friend-requests/${encodeURIComponent(requireFriendIdentifier(requestId))}`,
    "DELETE",
    undefined,
    fetcher,
  )
}

export async function deleteFriend(userId: string, fetcher: ClientDataFetch = fetch) {
  const response = await fetcher(
    `/api/client/friends/${encodeURIComponent(requireFriendIdentifier(userId))}`,
    {
      credentials: "include",
      method: "DELETE",
    },
  )
  const payload = await readJson<ClientDataErrorEnvelope | ClientDataSuccessEnvelope<unknown>>(
    response,
  )
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "删除好友失败")
  }
}

export async function listClientContacts(fetcher: ClientDataFetch = fetch) {
  const response = await fetcher("/api/client/contacts", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<ListClientContactsResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载通讯录失败")
  }

  const data = (payload as ClientDataSuccessEnvelope<ListClientContactsResponse> | undefined)?.data

  if (!data || !Array.isArray(data.apps) || !Array.isArray(data.groups)) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  const legacyUsers = Array.isArray(data.users) ? data.users.map(normalizeContactUser) : null
  const hasCurrentContract =
    Array.isArray(data.user_ids) &&
    data.user_ids.every((id) => typeof id === "string" && id.trim()) &&
    (data.directory_mode === "organization" || data.directory_mode === "friends")
  if (!hasCurrentContract && !legacyUsers) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }
  const initialUsers = (legacyUsers ?? []).map((user) => ({
    ...user,
    // Legacy contacts did not expose a version. It is a seed only and cannot replace a resolved profile.
    updatedAt: "",
  }))
  const userIds = hasCurrentContract
    ? [...new Set(data.user_ids!)]
    : initialUsers.map((user) => user.id)

  return {
    apps: data.apps.map(normalizeContactApp),
    directoryMode: hasCurrentContract ? data.directory_mode! : "organization",
    groups: data.groups.map(normalizeContactGroup),
    initialUsers,
    userIds,
  }
}

function normalizeClientUser(user: ClientUserResponse | undefined): ClientUser {
  if (!user?.created_at || !user.email || !user.id || !user.name) {
    throw new ClientDataRequestError("当前用户响应格式不正确")
  }

  return {
    avatar: user.avatar ?? "",
    createdAt: user.created_at,
    email: user.email,
    id: user.id,
    lastOnlineAt: user.last_online_at ?? null,
    name: user.name,
    nickname: user.nickname ?? "",
    phone: user.phone ?? "",
    status: user.status === "disabled" ? "disabled" : "active",
  }
}

function normalizeContactUser(contact: ContactUserResponse | undefined): ContactUser {
  if (!contact?.id || !contact.id.trim()) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  return {
    avatar: contact.avatar ?? "",
    email: contact.email ?? "",
    id: contact.id,
    lastOnlineAt: contact.last_online_at ?? null,
    name: contact.name ?? "",
    nickname: contact.nickname ?? "",
    online: Boolean(contact.online),
    phone: contact.phone ?? "",
    type: "user",
  }
}

async function readFriendRequestList(response: Response, fallback: string) {
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<ListFriendRequestsResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, fallback)
  }
  const requests = (payload as ClientDataSuccessEnvelope<ListFriendRequestsResponse> | undefined)
    ?.data?.requests
  if (!Array.isArray(requests)) {
    throw new ClientDataRequestError("好友申请响应格式不正确")
  }
  return requests.map(normalizeFriendRequest)
}

async function mutateFriendRequest(
  url: string,
  method: "DELETE" | "POST",
  body: Record<string, string> | undefined,
  fetcher: ClientDataFetch,
) {
  const response = await fetcher(url, {
    ...(body
      ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
      : {}),
    credentials: "include",
    method,
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<FriendRequestResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "好友操作失败")
  }
  return normalizeFriendRequest(
    (payload as ClientDataSuccessEnvelope<FriendRequestResponse> | undefined)?.data,
  )
}

function normalizeFriendRequest(value: FriendRequestResponse | undefined): FriendRequest {
  if (
    !value?.id ||
    !value.requester_user_id ||
    !value.addressee_user_id ||
    !value.created_at ||
    !value.updated_at ||
    !isValidDate(value.created_at) ||
    !isValidDate(value.updated_at) ||
    (value.handled_at !== undefined &&
      value.handled_at !== null &&
      !isValidDate(value.handled_at)) ||
    (value.status !== "pending" &&
      value.status !== "accepted" &&
      value.status !== "rejected" &&
      value.status !== "canceled")
  ) {
    throw new ClientDataRequestError("好友申请响应格式不正确")
  }
  return {
    addresseeUserId: value.addressee_user_id,
    createdAt: value.created_at,
    handledAt: value.handled_at ?? null,
    id: value.id,
    requesterUserId: value.requester_user_id,
    status: value.status,
    updatedAt: value.updated_at,
  }
}

function normalizeContactApp(app: ContactAppResponse | undefined): ContactApp {
  if (
    !app?.id ||
    !app.name ||
    (app.creator_user_id !== null && typeof app.creator_user_id !== "string")
  ) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  return {
    avatar: app.avatar ?? "",
    creatorUserId: app.creator_user_id,
    description: app.description ?? "",
    id: app.id,
    name: app.name,
    online: Boolean(app.online),
    type: "app",
  }
}

function normalizeContactGroup(group: ContactGroupResponse | undefined): ContactGroup {
  if (!group?.id || !group.name) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  return {
    avatar: group.avatar ?? "",
    avatarMembers: (group.avatar_members ?? []).map(normalizeContactGroupAvatarMember),
    id: group.id,
    joined: Boolean(group.joined),
    memberCount: group.member_count ?? 0,
    name: group.name,
    type: "group",
    visibility: normalizeVisibility(group.visibility),
  }
}

function normalizeContactGroupAvatarMember(
  member: NonNullable<ContactGroupResponse["avatar_members"]>[number] | undefined,
): ContactGroupAvatarMember {
  const type = member?.type === "app" ? "app" : "user"
  if (!member || (type === "app" && !member.name)) {
    throw new ClientDataRequestError("通讯录群头像成员响应格式不正确")
  }
  return {
    avatar: member.avatar ?? "",
    id: member.id ?? "",
    name: member.name ?? "",
    nickname: member.nickname ?? "",
    role: member.role === "owner" || member.role === "admin" ? member.role : ("member" as const),
    type,
  }
}

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value))
}

function requireFriendIdentifier(value: string) {
  if (!value.trim()) throw new ClientDataRequestError("好友标识格式不正确")
  return value
}
