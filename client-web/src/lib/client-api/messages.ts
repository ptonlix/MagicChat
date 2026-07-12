import { ClientDataRequestError, createRequestError, readJson } from "./core"
import type {
  ClientDataFetch,
  ClientDataSuccessEnvelope,
  ClientDataErrorEnvelope,
  ListConversationMessagesResponse,
  CreateMessageResponse,
  RevokeConversationMessageResponse,
  MarkConversationReadResponse,
  MessageCreatedEventPayloadResponse,
  MessageUpdatedEventPayloadResponse,
  ConversationRemovedEventPayloadResponse,
  ConversationMemberMentionedEventPayloadResponse,
  ReadTemporaryFileURLsResponse,
  ClientMessageBody,
  ClientMessage,
  ListConversationMessagesOptions,
  SendConversationTextMessageInput,
  SendConversationMarkdownMessageInput,
  SendConversationLinkMessageInput,
  SendConversationFileMessageInput,
  SendConversationImageMessageInput,
  SendConversationVoiceMessageInput,
  TemporaryFileReadURL,
  MarkConversationReadOptions,
  MarkConversationReadResult,
} from "./types"
import {
  isTemporaryFileReadURLFresh,
  normalizeMarkConversationReadResult,
  normalizeMessage,
  normalizeMessagePage,
  normalizeTemporaryFileReadURL,
} from "./message-normalizers"

const temporaryFileReadURLCache = new Map<string, TemporaryFileReadURL>()

export async function listConversationMessages(
  conversationId: string,
  options: ListConversationMessagesOptions = {},
  fetcher: ClientDataFetch = fetch
) {
  const searchParams = new URLSearchParams()
  searchParams.set("limit", String(options.limit ?? 20))
  if (options.beforeSeq !== undefined) {
    searchParams.set("before_seq", String(options.beforeSeq))
  }
  if (options.afterSeq !== undefined) {
    searchParams.set("after_seq", String(options.afterSeq))
  }

  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(
      conversationId
    )}/messages?${searchParams.toString()}`,
    {
      credentials: "include",
      method: "GET",
    }
  )
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<ListConversationMessagesResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载消息失败")
  }

  const data = (
    payload as
      ClientDataSuccessEnvelope<ListConversationMessagesResponse> | undefined
  )?.data

  if (!data?.messages || !data.page) {
    throw new ClientDataRequestError("消息列表响应格式不正确")
  }

  return {
    messages: data.messages.map(normalizeMessage),
    page: normalizeMessagePage(data.page),
  }
}

export async function sendConversationTextMessage(
  conversationId: string,
  input: SendConversationTextMessageInput,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      body: JSON.stringify({
        client_message_id: input.clientMessageId,
        reply_to_message_id: input.replyToMessageId,
        body: {
          type: "text",
          content: input.content,
        },
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  )
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<CreateMessageResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "发送消息失败")
  }

  const message = (
    payload as ClientDataSuccessEnvelope<CreateMessageResponse> | undefined
  )?.data?.message

  return normalizeMessage(message)
}

export async function sendConversationMarkdownMessage(
  conversationId: string,
  input: SendConversationMarkdownMessageInput,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      body: JSON.stringify({
        client_message_id: input.clientMessageId,
        reply_to_message_id: input.replyToMessageId,
        body: {
          type: "markdown",
          content: input.content,
        },
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  )
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<CreateMessageResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "发送富文本消息失败")
  }

  const message = (
    payload as ClientDataSuccessEnvelope<CreateMessageResponse> | undefined
  )?.data?.message

  return normalizeMessage(message)
}

export async function sendConversationLinkMessage(
  conversationId: string,
  input: SendConversationLinkMessageInput,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      body: JSON.stringify({
        client_message_id: input.clientMessageId,
        reply_to_message_id: input.replyToMessageId,
        body: {
          type: "link",
          url: input.url,
        },
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  )
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<CreateMessageResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "发送链接失败")
  }

  const message = (
    payload as ClientDataSuccessEnvelope<CreateMessageResponse> | undefined
  )?.data?.message

  return normalizeMessage(message)
}

export async function sendConversationFileMessage(
  conversationId: string,
  input: SendConversationFileMessageInput,
  fetcher: ClientDataFetch = fetch
) {
  const formData = new FormData()
  formData.set("client_message_id", input.clientMessageId)
  if (input.replyToMessageId) {
    formData.set("reply_to_message_id", input.replyToMessageId)
  }
  formData.set("file", input.file)

  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/files`,
    {
      body: formData,
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<CreateMessageResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "发送文件失败")
  }

  const message = (
    payload as ClientDataSuccessEnvelope<CreateMessageResponse> | undefined
  )?.data?.message

  return normalizeMessage(message)
}

export async function sendConversationImageMessage(
  conversationId: string,
  input: SendConversationImageMessageInput,
  fetcher: ClientDataFetch = fetch
) {
  const formData = new FormData()
  formData.set("client_message_id", input.clientMessageId)
  if (input.replyToMessageId) {
    formData.set("reply_to_message_id", input.replyToMessageId)
  }
  formData.set("image", input.image)

  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/images`,
    {
      body: formData,
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<CreateMessageResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "发送图片失败")
  }

  const message = (
    payload as ClientDataSuccessEnvelope<CreateMessageResponse> | undefined
  )?.data?.message

  return normalizeMessage(message)
}

export async function sendConversationVoiceMessage(
  conversationId: string,
  input: SendConversationVoiceMessageInput,
  fetcher: ClientDataFetch = fetch
) {
  const formData = new FormData()
  formData.set("client_message_id", input.clientMessageId)
  formData.set("duration_ms", String(input.durationMS))
  if (input.replyToMessageId) {
    formData.set("reply_to_message_id", input.replyToMessageId)
  }
  formData.set("voice", input.voice, "voice-message.webm")

  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/voices`,
    {
      body: formData,
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<CreateMessageResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "发送语音失败")
  }

  const message = (
    payload as ClientDataSuccessEnvelope<CreateMessageResponse> | undefined
  )?.data?.message

  return normalizeMessage(message)
}

export async function revokeConversationMessage(
  conversationId: string,
  messageId: string,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/revoke`,
    {
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<RevokeConversationMessageResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "撤回消息失败")
  }

  const data = (
    payload as
      ClientDataSuccessEnvelope<RevokeConversationMessageResponse> | undefined
  )?.data
  if (!data?.message || !data.system_message) {
    throw new ClientDataRequestError("撤回消息响应格式不正确")
  }

  return {
    message: normalizeMessage(data.message),
    systemMessage: normalizeMessage(data.system_message),
  }
}

export async function readTemporaryFileURLs(
  fileIds: string[],
  fetcher: ClientDataFetch = fetch
): Promise<TemporaryFileReadURL[]> {
  if (fileIds.length === 0) {
    return []
  }

  const now = Date.now()
  const urlsByID = new Map<string, TemporaryFileReadURL>()
  const missingFileIDs: string[] = []

  for (const fileId of new Set(fileIds)) {
    const cachedURL = temporaryFileReadURLCache.get(fileId)

    if (cachedURL && isTemporaryFileReadURLFresh(cachedURL, now)) {
      urlsByID.set(fileId, cachedURL)
      continue
    }

    temporaryFileReadURLCache.delete(fileId)
    missingFileIDs.push(fileId)
  }

  if (missingFileIDs.length === 0) {
    return fileIds.map((fileId) => urlsByID.get(fileId)).filter(isDefined)
  }

  const response = await fetcher("/api/client/temporary-files/read-urls", {
    body: JSON.stringify({
      file_ids: missingFileIDs,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<ReadTemporaryFileURLsResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "获取文件下载地址失败")
  }

  const urls = (
    payload as
      ClientDataSuccessEnvelope<ReadTemporaryFileURLsResponse> | undefined
  )?.data?.urls

  if (!Array.isArray(urls)) {
    throw new ClientDataRequestError("文件下载地址响应格式不正确")
  }

  for (const url of urls.map(normalizeTemporaryFileReadURL)) {
    temporaryFileReadURLCache.set(url.fileId, url)
    urlsByID.set(url.fileId, url)
  }

  const orderedURLs = fileIds.map((fileId) => urlsByID.get(fileId))
  if (orderedURLs.some((url) => !url)) {
    throw new ClientDataRequestError("文件下载地址响应格式不正确")
  }

  return orderedURLs.filter(isDefined)
}

export async function markConversationRead(
  conversationId: string,
  options: MarkConversationReadOptions = {},
  fetcher: ClientDataFetch = fetch
): Promise<MarkConversationReadResult> {
  const body =
    options.upToSeq === undefined
      ? {}
      : {
          up_to_seq: options.upToSeq,
        }
  const response = await fetcher(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/read`,
    {
      body: JSON.stringify(body),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  )
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<MarkConversationReadResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "标记会话已读失败")
  }

  return normalizeMarkConversationReadResult(
    (
      payload as
        ClientDataSuccessEnvelope<MarkConversationReadResponse> | undefined
    )?.data
  )
}

export function normalizeMessageCreatedEventPayload(
  payload: unknown
): ClientMessage {
  if (!isObject(payload)) {
    throw new ClientDataRequestError("消息推送格式不正确")
  }

  return normalizeMessage(
    (payload as MessageCreatedEventPayloadResponse).message
  )
}

export function normalizeMessageUpdatedEventPayload(
  payload: unknown
): ClientMessage {
  if (!isObject(payload)) {
    throw new ClientDataRequestError("消息更新推送格式不正确")
  }

  return normalizeMessage(
    (payload as MessageUpdatedEventPayloadResponse).message
  )
}

export function normalizeConversationRemovedEventPayload(payload: unknown) {
  if (!isObject(payload)) {
    throw new ClientDataRequestError("会话移除推送格式不正确")
  }

  const conversationId = (payload as ConversationRemovedEventPayloadResponse)
    .conversation_id
  if (typeof conversationId !== "string" || conversationId.trim() === "") {
    throw new ClientDataRequestError("会话移除推送格式不正确")
  }

  return {
    conversationId,
  }
}

export function normalizeConversationMemberMentionedEventPayload(
  payload: unknown
) {
  if (!isObject(payload)) {
    throw new ClientDataRequestError("会话提醒推送格式不正确")
  }

  const event = payload as ConversationMemberMentionedEventPayloadResponse
  if (
    typeof event.conversation_id !== "string" ||
    event.conversation_id.trim() === "" ||
    typeof event.last_mentioned_seq !== "number"
  ) {
    throw new ClientDataRequestError("会话提醒推送格式不正确")
  }

  return {
    conversationId: event.conversation_id,
    lastMentionedSeq: event.last_mentioned_seq,
  }
}

export function formatClientMessageBodySummary(body: ClientMessageBody) {
  if (body.type === "text") {
    return body.content
  }

  if (body.type === "markdown") {
    return formatMarkdownMessageSummary(body.content)
  }

  if (body.type === "link") {
    return `[链接] ${body.title}`
  }

  if (body.type === "file") {
    return `[文件] ${body.name}`
  }

  if (body.type === "image") {
    return "[图片]"
  }

  if (body.type === "voice") {
    const summary = `[语音] ${formatVoiceMessageDuration(body.durationMS)}`

    return body.transcript ? `${summary} - ${body.transcript}` : summary
  }

  if (body.type === "revoked") {
    return "该消息已被撤回"
  }

  if (body.event === "message_revoked") {
    return `${body.actor.displayName} 撤回了一条消息`
  }

  if (body.event === "group_avatar_updated") {
    return `${body.actor.displayName} 修改了群头像`
  }

  if (body.event === "group_visibility_changed") {
    if (body.visibility === "public") {
      return `${body.actor.displayName} 将当前群设置为公开群`
    }

    return `${body.actor.displayName} 将当前群设为私有群`
  }

  if (body.event === "group_member_joined") {
    return `${body.actor.displayName} 加入群聊`
  }

  if (body.event === "group_member_left") {
    return `${body.actor.displayName} 已退出群聊`
  }

  if (body.event === "group_member_removed") {
    return `${body.actor.displayName} 已将 ${body.target.displayName} 移出群聊`
  }

  if (body.event === "group_name_updated") {
    return `${body.actor.displayName} 修改群聊名称为 ${body.name}`
  }

  return `${body.inviter.displayName} 邀请 ${body.invitees
    .map((invitee) => invitee.displayName)
    .join(",")} 加入群聊`
}

function formatVoiceMessageDuration(durationMS: number) {
  const totalSeconds = Math.ceil(durationMS / 1_000)

  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`
}

function formatMarkdownMessageSummary(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, (block) =>
      block
        .replace(/^```[^\n]*\n?/, "")
        .replace(/```$/, "")
        .trim()
    )
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

export function isClientMessageInitiatedByUser(
  message: ClientMessage,
  userId: string
) {
  if (message.sender.type === "user") {
    return message.sender.id === userId
  }

  if (message.body.type !== "system_event") {
    return false
  }

  if (message.body.event === "group_avatar_updated") {
    return message.body.actor.id === userId
  }

  if (
    message.body.event === "group_visibility_changed" ||
    message.body.event === "group_member_joined" ||
    message.body.event === "group_member_left" ||
    message.body.event === "group_member_removed" ||
    message.body.event === "group_name_updated" ||
    message.body.event === "message_revoked"
  ) {
    return message.body.actor.id === userId
  }

  return message.body.inviter.id === userId
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
