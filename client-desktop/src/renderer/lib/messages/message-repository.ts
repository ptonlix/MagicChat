import type { ClientMessage } from "@/lib/client-data-api"
import type {
  MessageCacheCommitResult,
  MessageCacheGeneration,
  MessageCachePage,
  MessageCacheStats,
  MessageCacheSyncState,
} from "@shared/message-cache-contract"

export interface MessageRepository {
  clear(): Promise<void>
  clearConversation(conversationId: string): Promise<MessageCacheGeneration>
  commitAfter(
    conversationId: string,
    afterSeq: number,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreBefore: boolean,
    generation: MessageCacheGeneration,
  ): Promise<MessageCacheCommitResult>
  commitBefore(
    conversationId: string,
    beforeSeq: number,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreBefore: boolean,
    generation: MessageCacheGeneration,
  ): Promise<MessageCacheCommitResult>
  commitLatest(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreBefore: boolean,
    generation: MessageCacheGeneration,
  ): Promise<MessageCacheCommitResult>
  getById(conversationId: string, messageId: string): Promise<ClientMessage | null>
  getStats(): Promise<MessageCacheStats>
  getSyncState(conversationId: string): Promise<MessageCacheSyncState>
  listSyncStates(): Promise<ReadonlyArray<MessageCacheSyncState>>
  readBefore(conversationId: string, beforeSeq: number, limit: number): Promise<MessageCachePage>
  readRecent(conversationId: string, limit: number): Promise<MessageCachePage>
  remove(
    conversationId: string,
    messageId: string,
    generation: MessageCacheGeneration,
  ): Promise<void>
  upsert(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
    generation: MessageCacheGeneration,
  ): Promise<void>
}
