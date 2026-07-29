import type { ClientMessage } from "@/lib/client-data-api"
import { mergeManagedMessages } from "./message-state"

export class MessageWorkingSet {
  private readonly conversations = new Map<string, ClientMessage[]>()

  get(conversationId: string): ClientMessage[] {
    return this.conversations.get(conversationId) ?? []
  }

  merge(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
    isDeleted?: (message: ClientMessage) => boolean,
  ): ClientMessage[] {
    const next = mergeManagedMessages(this.get(conversationId), messages, isDeleted)
    this.conversations.set(conversationId, next)
    return next
  }

  replace(conversationId: string, messages: ReadonlyArray<ClientMessage>): ClientMessage[] {
    const next = mergeManagedMessages([], messages)
    this.conversations.set(conversationId, next)
    return next
  }

  update(
    conversationId: string,
    messageId: string,
    updater: (message: ClientMessage) => ClientMessage | null,
  ): ClientMessage[] {
    const messages = this.get(conversationId)
    const next = messages
      .map((message) => (message.id === messageId ? updater(message) : message))
      .filter((message): message is ClientMessage => message !== null)
    this.conversations.set(conversationId, next)
    return next
  }

  remove(conversationId: string, messageId: string): ClientMessage[] {
    const next = this.get(conversationId).filter((message) => message.id !== messageId)
    this.conversations.set(conversationId, next)
    return next
  }

  compact(conversationId: string, limit: number): ClientMessage[] {
    const messages = this.get(conversationId)
    if (messages.length <= limit) return messages
    const next = messages.slice(-limit)
    this.conversations.set(conversationId, next)
    return next
  }

  clearConversation(conversationId: string): void {
    this.conversations.delete(conversationId)
  }

  clear(): void {
    this.conversations.clear()
  }
}
