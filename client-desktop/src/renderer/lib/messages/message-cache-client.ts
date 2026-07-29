import type { AuthenticatedTarget } from "@shared/client-contract"
import type { MessageCacheGeneration } from "@shared/message-cache-contract"
import type { ClientMessage } from "@/lib/client-data-api"
import type { MessageRepository } from "./message-repository"
import { deserializeMessage, serializeMessage } from "./message-serializer"

let configuredTarget: AuthenticatedTarget | null = null

export function configureMessageCacheTarget(target: AuthenticatedTarget): () => void {
  configuredTarget = target
  return () => {
    if (configuredTarget === target) configuredTarget = null
  }
}

export function getMessageCacheTarget(): AuthenticatedTarget | null {
  return configuredTarget
}

export class DesktopMessageRepository implements MessageRepository {
  constructor(private readonly target: AuthenticatedTarget) {}

  clear(): Promise<void> {
    return window.desktop.messageCache.clearUser(this.target)
  }

  clearConversation(conversationId: string) {
    return window.desktop.messageCache.clearConversation(this.scope(conversationId))
  }

  commitAfter(
    conversationId: string,
    afterSeq: number,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreBefore: boolean,
    generation: MessageCacheGeneration,
  ) {
    return window.desktop.messageCache.commitAfter(this.scope(conversationId), {
      generation,
      hasMoreBefore,
      records: messages.map(serializeMessage),
      requestAfterSeq: afterSeq,
    })
  }

  commitBefore(
    conversationId: string,
    beforeSeq: number,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreBefore: boolean,
    generation: MessageCacheGeneration,
  ) {
    return window.desktop.messageCache.commitBefore(this.scope(conversationId), {
      generation,
      hasMoreBefore,
      records: messages.map(serializeMessage),
      requestBeforeSeq: beforeSeq,
    })
  }

  commitLatest(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreBefore: boolean,
    generation: MessageCacheGeneration,
  ) {
    return window.desktop.messageCache.commitLatest(this.scope(conversationId), {
      generation,
      hasMoreBefore,
      records: messages.map(serializeMessage),
    })
  }

  async getById(conversationId: string, messageId: string) {
    const record = await window.desktop.messageCache.getById(this.scope(conversationId), messageId)
    return record ? deserializeMessage(record) : null
  }

  getStats() {
    return window.desktop.messageCache.getStats(this.target)
  }

  getSyncState(conversationId: string) {
    return window.desktop.messageCache.getSyncState(this.scope(conversationId))
  }

  listSyncStates() {
    return window.desktop.messageCache.listSyncStates(this.target)
  }

  readBefore(conversationId: string, beforeSeq: number, limit: number) {
    return window.desktop.messageCache.readBefore(this.scope(conversationId), beforeSeq, limit)
  }

  readRecent(conversationId: string, limit: number) {
    return window.desktop.messageCache.readRecent(this.scope(conversationId), limit)
  }

  remove(conversationId: string, messageId: string, generation: MessageCacheGeneration) {
    return window.desktop.messageCache.removeMessage(
      this.scope(conversationId),
      messageId,
      generation,
    )
  }

  upsert(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
    generation: MessageCacheGeneration,
  ) {
    return window.desktop.messageCache.upsert(
      this.scope(conversationId),
      messages.map(serializeMessage),
      generation,
    )
  }

  private scope(conversationId: string) {
    return { conversationId, target: this.target }
  }
}
