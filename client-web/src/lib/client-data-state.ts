import {
  ClientDataRequestError,
  formatClientMessageBodySummary,
  type ClientConversation,
  type ClientMessage,
  type ClientMessagePage,
} from "@/lib/client-data-api"
import type { ClientConversationMessageState } from "@/lib/client-data-context"

export const messagePageLimit = 20

export const emptyConversationMessageState: ClientConversationMessageState = {
  error: null,
  loaded: false,
  loading: false,
  loadingBefore: false,
  messages: [],
  page: null,
  sending: false,
}

export function getMessageSummary(message: ClientMessage) {
  return formatClientMessageBodySummary(message.body)
}

export function createConversationMessageState(): ClientConversationMessageState {
  return {
    error: null,
    loaded: false,
    loading: false,
    loadingBefore: false,
    messages: [],
    page: null,
    sending: false,
  }
}

export function mergeConversationMessages(
  currentMessages: ClientMessage[],
  nextMessages: ClientMessage[]
) {
  const messagesById = new Map<string, ClientMessage>()

  for (const message of currentMessages) {
    messagesById.set(message.id, message)
  }
  for (const message of nextMessages) {
    messagesById.set(message.id, message)
  }

  return Array.from(messagesById.values()).sort((messageA, messageB) => {
    if (messageA.seq !== messageB.seq) {
      return messageA.seq - messageB.seq
    }

    return messageA.createdAt.localeCompare(messageB.createdAt)
  })
}

export function updatePageWithMessage(
  page: ClientMessagePage | null,
  messages: ClientMessage[]
): ClientMessagePage {
  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]

  return {
    hasMoreAfter: false,
    hasMoreBefore: page?.hasMoreBefore ?? false,
    limit: page?.limit ?? messagePageLimit,
    newestSeq: lastMessage?.seq ?? 0,
    oldestSeq: firstMessage?.seq ?? 0,
  }
}

export function mergePageWithBeforeResult(
  currentPage: ClientMessagePage | null,
  resultPage: ClientMessagePage,
  messages: ClientMessage[]
): ClientMessagePage {
  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]

  return {
    hasMoreAfter: currentPage?.hasMoreAfter ?? resultPage.hasMoreAfter,
    hasMoreBefore: resultPage.hasMoreBefore,
    limit: resultPage.limit,
    newestSeq: lastMessage?.seq ?? currentPage?.newestSeq ?? 0,
    oldestSeq: firstMessage?.seq ?? resultPage.oldestSeq,
  }
}

export function mergePageWithAfterResult(
  currentPage: ClientMessagePage | null,
  resultPage: ClientMessagePage,
  messages: ClientMessage[]
): ClientMessagePage {
  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]

  return {
    hasMoreAfter: resultPage.hasMoreAfter,
    hasMoreBefore: currentPage?.hasMoreBefore ?? resultPage.hasMoreBefore,
    limit: resultPage.limit,
    newestSeq: lastMessage?.seq ?? resultPage.newestSeq,
    oldestSeq: firstMessage?.seq ?? currentPage?.oldestSeq ?? 0,
  }
}

export function getNewestMessageSeq(state: ClientConversationMessageState) {
  const lastMessage = state.messages[state.messages.length - 1]

  return Math.max(state.page?.newestSeq ?? 0, lastMessage?.seq ?? 0)
}

export function pinAppConversations(conversations: ClientConversation[]) {
  const appConversations: ClientConversation[] = []
  const otherConversations: ClientConversation[] = []

  for (const conversation of conversations) {
    if (conversation.type === "app") {
      appConversations.push(conversation)
    } else {
      otherConversations.push(conversation)
    }
  }

  return [...appConversations, ...otherConversations]
}

export function getClientDataErrorMessage(
  error: unknown,
  fallbackMessage: string
) {
  if (error instanceof ClientDataRequestError) {
    return error.message
  }

  return fallbackMessage
}
