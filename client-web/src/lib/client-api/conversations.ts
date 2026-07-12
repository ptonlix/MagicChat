import {
  ClientDataRequestError,
  createRequestError,
  normalizeVisibility,
  readJson,
} from "./core"
import { normalizeMessage } from "./message-normalizers"
import type {
  ClientDataFetch,
  ClientDataSuccessEnvelope,
  ClientDataErrorEnvelope,
  ConversationResponse,
  ConversationProjectResponse,
  ConversationMemberResponse,
  ListClientConversationsResponse,
  CreateDirectConversationResponse,
  CreateAppConversationResponse,
  CreateGroupConversationResponse,
  AddGroupConversationMembersResponse,
  GroupConversationActionResponse,
  LeaveGroupConversationResponse,
  DissolveGroupConversationResponse,
  UploadGroupConversationAvatarResponse,
  ClientConversation,
  ClientConversationProject,
  ClientConversationMember,
  CreateGroupConversationInput,
  AddGroupConversationMembersInput,
  UpdateGroupConversationNameInput,
  AddGroupConversationMembersResult,
  GroupConversationActionResult,
  UploadGroupConversationAvatarResult,
  LeaveGroupConversationResult,
  DissolveGroupConversationResult,
} from "./types"

export async function listClientConversations(
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher("/api/client/conversations", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<ListClientConversationsResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载会话列表失败")
  }

  const conversations = (
    payload as
      ClientDataSuccessEnvelope<ListClientConversationsResponse> | undefined
  )?.data?.conversations

  if (!conversations) {
    throw new ClientDataRequestError("会话列表响应格式不正确")
  }

  return conversations.map(normalizeConversation)
}

export async function createDirectConversation(
  userId: string,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher("/api/client/conversations/direct", {
    body: JSON.stringify({
      user_id: userId,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<CreateDirectConversationResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "创建一对一会话失败")
  }

  const conversation = (
    payload as
      ClientDataSuccessEnvelope<CreateDirectConversationResponse> | undefined
  )?.data?.conversation

  return normalizeConversation(conversation)
}

export async function openAppConversation(
  appId: string,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher("/api/client/conversations/apps", {
    body: JSON.stringify({
      app_id: appId,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<CreateAppConversationResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "创建应用会话失败")
  }

  const conversation = (
    payload as
      ClientDataSuccessEnvelope<CreateAppConversationResponse> | undefined
  )?.data?.conversation

  return normalizeConversation(conversation)
}

export async function createGroupConversation(
  input: CreateGroupConversationInput,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher("/api/client/conversations/groups", {
    body: JSON.stringify({
      app_ids: input.appIds ?? [],
      member_ids: input.memberIds,
      name: input.name,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<CreateGroupConversationResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "创建群聊失败")
  }

  const conversation = (
    payload as
      ClientDataSuccessEnvelope<CreateGroupConversationResponse> | undefined
  )?.data?.conversation

  return normalizeConversation(conversation)
}

export async function joinGroupConversation(
  conversationId: string,
  fetcher: ClientDataFetch = fetch
): Promise<GroupConversationActionResult> {
  return postGroupConversationAction(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/join`,
    "加入群聊失败",
    fetcher
  )
}

export async function setGroupConversationPublic(
  conversationId: string,
  fetcher: ClientDataFetch = fetch
): Promise<GroupConversationActionResult> {
  return postGroupConversationAction(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/public`,
    "设置公开群失败",
    fetcher
  )
}

export async function setGroupConversationPrivate(
  conversationId: string,
  fetcher: ClientDataFetch = fetch
): Promise<GroupConversationActionResult> {
  return postGroupConversationAction(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/private`,
    "取消公开群失败",
    fetcher
  )
}

export async function updateGroupConversationName(
  conversationId: string,
  input: UpdateGroupConversationNameInput,
  fetcher: ClientDataFetch = fetch
): Promise<GroupConversationActionResult> {
  const response = await fetcher(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/name`,
    {
      body: JSON.stringify({
        name: input.name,
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    }
  )
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<GroupConversationActionResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "修改群聊名称失败")
  }

  const data = (
    payload as
      ClientDataSuccessEnvelope<GroupConversationActionResponse> | undefined
  )?.data

  if (!data?.conversation) {
    throw new ClientDataRequestError("修改群聊名称响应格式不正确")
  }

  return {
    conversation: normalizeConversation(data.conversation),
    message: data.message ? normalizeMessage(data.message) : null,
  }
}

export async function leaveGroupConversation(
  conversationId: string,
  fetcher: ClientDataFetch = fetch
): Promise<LeaveGroupConversationResult> {
  const response = await fetcher(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/leave`,
    {
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<LeaveGroupConversationResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "退出群聊失败")
  }

  const data = (
    payload as
      ClientDataSuccessEnvelope<LeaveGroupConversationResponse> | undefined
  )?.data

  if (!data?.conversation_id || !data.message) {
    throw new ClientDataRequestError("退出群聊响应格式不正确")
  }

  return {
    conversationId: data.conversation_id,
    message: normalizeMessage(data.message),
  }
}

export async function dissolveGroupConversation(
  conversationId: string,
  fetcher: ClientDataFetch = fetch
): Promise<DissolveGroupConversationResult> {
  const response = await fetcher(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}`,
    {
      credentials: "include",
      method: "DELETE",
    }
  )
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<DissolveGroupConversationResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "解散群聊失败")
  }

  const data = (
    payload as
      ClientDataSuccessEnvelope<DissolveGroupConversationResponse> | undefined
  )?.data

  if (!data?.conversation_id) {
    throw new ClientDataRequestError("解散群聊响应格式不正确")
  }

  return {
    conversationId: data.conversation_id,
  }
}

export async function removeGroupConversationMember(
  conversationId: string,
  memberId: string,
  memberTypeOrFetcher: "user" | "app" | ClientDataFetch = "user",
  fetcher: ClientDataFetch = fetch
): Promise<GroupConversationActionResult> {
  const memberType =
    typeof memberTypeOrFetcher === "function" ? "user" : memberTypeOrFetcher
  const activeFetcher =
    typeof memberTypeOrFetcher === "function" ? memberTypeOrFetcher : fetcher
  const url =
    memberType === "user"
      ? `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(memberId)}`
      : `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(memberType)}/${encodeURIComponent(memberId)}`

  const response = await activeFetcher(url, {
    credentials: "include",
    method: "DELETE",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<GroupConversationActionResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "移出群聊成员失败")
  }

  const data = (
    payload as
      ClientDataSuccessEnvelope<GroupConversationActionResponse> | undefined
  )?.data

  if (!data?.conversation) {
    throw new ClientDataRequestError("移出群聊成员响应格式不正确")
  }

  return {
    conversation: normalizeConversation(data.conversation),
    message: data.message ? normalizeMessage(data.message) : null,
  }
}

async function postGroupConversationAction(
  url: string,
  fallbackMessage: string,
  fetcher: ClientDataFetch
): Promise<GroupConversationActionResult> {
  const response = await fetcher(url, {
    credentials: "include",
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<GroupConversationActionResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, fallbackMessage)
  }

  const data = (
    payload as
      ClientDataSuccessEnvelope<GroupConversationActionResponse> | undefined
  )?.data

  if (!data?.conversation) {
    throw new ClientDataRequestError("群聊操作响应格式不正确")
  }

  return {
    conversation: normalizeConversation(data.conversation),
    message: data.message ? normalizeMessage(data.message) : null,
  }
}

export async function addGroupConversationMembers(
  conversationId: string,
  input: AddGroupConversationMembersInput,
  fetcher: ClientDataFetch = fetch
): Promise<AddGroupConversationMembersResult> {
  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/members`,
    {
      body: JSON.stringify({
        app_ids: input.appIds ?? [],
        member_ids: input.memberIds ?? [],
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  )
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<AddGroupConversationMembersResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "添加群聊成员失败")
  }

  const data = (
    payload as
      ClientDataSuccessEnvelope<AddGroupConversationMembersResponse> | undefined
  )?.data

  if (!data?.conversation) {
    throw new ClientDataRequestError("添加群聊成员响应格式不正确")
  }

  return {
    conversation: normalizeConversation(data.conversation),
    message: data.message ? normalizeMessage(data.message) : null,
  }
}

export async function uploadGroupConversationAvatar(
  conversationId: string,
  file: File,
  fetcher: ClientDataFetch = fetch
): Promise<UploadGroupConversationAvatarResult> {
  const formData = new FormData()
  formData.set("file", file)

  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/avatar`,
    {
      body: formData,
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<UploadGroupConversationAvatarResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "上传群头像失败")
  }

  const data = (
    payload as
      | ClientDataSuccessEnvelope<UploadGroupConversationAvatarResponse>
      | undefined
  )?.data

  if (!data?.conversation || !data.message) {
    throw new ClientDataRequestError("上传群头像响应格式不正确")
  }

  return {
    conversation: normalizeConversation(data.conversation),
    message: normalizeMessage(data.message),
  }
}

function normalizeConversation(
  conversation: ConversationResponse | undefined
): ClientConversation {
  if (!conversation?.created_at || !conversation.id || !conversation.name) {
    throw new ClientDataRequestError("会话列表响应格式不正确")
  }

  const normalizedConversation: ClientConversation = {
    avatar: conversation.avatar ?? "",
    createdAt: conversation.created_at,
    id: conversation.id,
    lastMessageAt: conversation.last_message_at ?? null,
    lastMessageId: conversation.last_message_id ?? null,
    lastMessageSeq: conversation.last_message_seq ?? 0,
    lastMessageSummary: conversation.last_message_summary ?? "",
    lastMentionedSeq: conversation.last_mentioned_seq ?? 0,
    lastReadSeq: conversation.last_read_seq ?? 0,
    memberCount: conversation.member_count ?? 0,
    name: conversation.name,
    type: normalizeConversationType(conversation.type),
    unreadCount: conversation.unread_count ?? 0,
    visibility: normalizeVisibility(conversation.visibility),
  }

  if (conversation.members) {
    normalizedConversation.members = conversation.members.map(
      normalizeConversationMember
    )
  }

  if (conversation.projects) {
    normalizedConversation.projects = conversation.projects.map(
      normalizeConversationProject
    )
  }

  return normalizedConversation
}

function normalizeConversationProject(
  project: ConversationProjectResponse | undefined
): ClientConversationProject {
  if (!project?.id || !project.name) {
    throw new ClientDataRequestError("会话关联项目响应格式不正确")
  }

  return {
    avatar: project.avatar ?? "",
    description: project.description ?? "",
    id: project.id,
    name: project.name,
  }
}

function normalizeConversationMember(
  member: ConversationMemberResponse | undefined
): ClientConversationMember {
  const memberType = member?.type === "app" ? "app" : "user"
  if (!member?.id || !member.name || (memberType === "user" && !member.email)) {
    throw new ClientDataRequestError("会话成员响应格式不正确")
  }

  return {
    avatar: member.avatar ?? "",
    email: member.email ?? "",
    id: member.id,
    name: member.name,
    nickname: member.nickname ?? "",
    phone: member.phone ?? "",
    role: normalizeConversationMemberRole(member.role),
    type: memberType,
  }
}

function normalizeConversationMemberRole(role: string | undefined) {
  if (role === "owner" || role === "admin") {
    return role
  }

  return "member"
}

function normalizeConversationType(type: string | undefined) {
  if (type === "direct" || type === "app") {
    return type
  }

  return "group"
}
