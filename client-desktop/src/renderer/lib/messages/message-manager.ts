import type {
  ClientMessage,
  ClientMessagePage,
  MessageChoiceSnapshot,
  MessageChoiceUpdatedEvent,
  MessageReactionSnapshot,
  MessageReactionsUpdatedEvent,
} from "@/lib/client-data-api"
import {
  applyMessageChoiceSnapshot,
  applyMessageChoiceState,
  applyMessageReactionSnapshot,
  applyMessageReactionsUpdate,
} from "@/lib/client-data-state"
import type { MessageManagerEvent, MessageManagerListener } from "./message-events"
import type { MessageRepository } from "./message-repository"
import { deserializeMessage } from "./message-serializer"
import { MessageTombstones } from "./message-tombstones"
import { MessageWorkingSet } from "./message-working-set"
import {
  HistoryWindowStore,
  type HistoryWindowSnapshot,
  type HistoryWindowTarget,
} from "./history-window-store"
import { preserveNewerMessageState } from "./message-state"
import { MessageOperationCancelledError, type MessageOperationToken } from "./message-operation"
import {
  catchUpConversationMessages,
  MessageSyncSingleFlight,
  type CatchUpPage,
} from "./message-catch-up"

export type MessageSource = "after" | "before" | "cache" | "latest" | "local" | "realtime"
export type HistoryRequestGuard = () => boolean
export type MessageCatchUpCommit = Readonly<{
  committedSeq: number
  page: CatchUpPage
  requestAfterSeq: number
}>
export type MessageCatchUpHooks = Readonly<{
  onCacheCommitFailed?: (input: MessageCatchUpCommit) => void
  onCacheCommitted?: (input: MessageCatchUpCommit) => void
}>

export class MessageManager {
  private readonly listeners = new Set<MessageManagerListener>()
  private readonly singleFlight = new MessageSyncSingleFlight()
  private readonly tombstones = new MessageTombstones()
  private readonly workingSet = new MessageWorkingSet()
  private readonly historyWindows: HistoryWindowStore
  private readonly queues = new Map<string, Promise<void>>()
  private readonly memoryCursors = new Map<string, number>()
  private readonly conversationEpochs = new Map<string, number>()
  private readonly inactiveConversations = new Set<string>()
  private scopeBarrier: Promise<void> = Promise.resolve()
  private persistentCacheDisabled = false
  private scopeActive = true
  private scopeEpoch = 0

  constructor(
    private readonly repository: MessageRepository,
    historyWindowLimit = 300,
  ) {
    this.historyWindows = new HistoryWindowStore(historyWindowLimit)
  }

  subscribe(listener: MessageManagerListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getMessages(conversationId: string): ClientMessage[] {
    return this.workingSet.get(conversationId)
  }

  getHistoryWindow(conversationId: string): HistoryWindowSnapshot {
    return this.historyWindows.get(conversationId)
  }

  async replaceHistoryWindow(
    token: MessageOperationToken,
    target: HistoryWindowTarget,
    messages: ReadonlyArray<ClientMessage>,
    boundaries: Readonly<{ hasMoreAfter: boolean; hasMoreBefore: boolean }>,
    guard?: HistoryRequestGuard,
  ): Promise<HistoryWindowSnapshot> {
    return this.commitHistoryWindow(token, messages, guard, (accepted) =>
      this.historyWindows.replace(token.conversationId, target, accepted, boundaries),
    )
  }

  async mergeHistoryBefore(
    token: MessageOperationToken,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreBefore: boolean,
    guard?: HistoryRequestGuard,
  ): Promise<HistoryWindowSnapshot> {
    return this.commitHistoryWindow(token, messages, guard, (accepted) =>
      this.historyWindows.mergeBefore(token.conversationId, accepted, hasMoreBefore),
    )
  }

  async mergeHistoryAfter(
    token: MessageOperationToken,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreAfter: boolean,
    guard?: HistoryRequestGuard,
  ): Promise<HistoryWindowSnapshot> {
    return this.commitHistoryWindow(token, messages, guard, (accepted) =>
      this.historyWindows.mergeAfter(token.conversationId, accepted, hasMoreAfter),
    )
  }

  async hydrateHistoryAround(
    token: MessageOperationToken,
    target: HistoryWindowTarget,
    limit: number,
    guard?: HistoryRequestGuard,
  ): Promise<HistoryWindowSnapshot | null> {
    await this.awaitScopeBarrier(token)
    this.assertHistoryRequestCurrent(token, guard)
    if (this.persistentCacheDisabled) return null
    const page = await this.repository.readAround(token.conversationId, target.seq, limit)
    this.assertHistoryRequestCurrent(token, guard)
    const messages = page.messages
      .map(deserializeMessage)
      .filter((message): message is ClientMessage => message !== null)
    if (
      !page.complete ||
      messages.length !== page.messages.length ||
      !messages.some((message) => message.id === target.messageId)
    ) {
      return null
    }
    return this.enqueue(token, async () => {
      this.assertHistoryRequestCurrent(token, guard)
      const accepted = messages.filter(
        (message) => !this.tombstones.has(token.conversationId, message.id),
      )
      if (!accepted.some((message) => message.id === target.messageId)) return null
      const snapshot = this.historyWindows.replace(token.conversationId, target, accepted, {
        hasMoreAfter: page.hasMoreAfter,
        hasMoreBefore: page.hasMoreBefore,
      })
      this.publish({
        conversationId: token.conversationId,
        kind: "history-window-changed",
        snapshot,
      })
      return snapshot
    })
  }

  async clearHistoryWindow(conversationId: string): Promise<void> {
    const token = this.beginConversationOperation(conversationId)
    await this.enqueue(token, async () => {
      const snapshot = this.historyWindows.clearConversation(conversationId)
      this.publish({ conversationId, kind: "history-window-changed", snapshot })
    })
  }

  beginConversationOperation(conversationId: string): MessageOperationToken {
    const barrier = this.scopeBarrier
    const token = {
      conversationEpoch: this.conversationEpochs.get(conversationId) ?? 0,
      conversationId,
      generation: this.persistentCacheDisabled
        ? Promise.resolve(null)
        : barrier
            .then(() => this.repository.getSyncState(conversationId))
            .then((state) => state.generation)
            .catch(() => null),
      scopeEpoch: this.scopeEpoch,
    }
    this.assertOperationCurrent(token)
    return token
  }

  activateConversation(conversationId: string): void {
    if (!this.scopeActive || !this.inactiveConversations.has(conversationId)) return
    this.conversationEpochs.set(
      conversationId,
      (this.conversationEpochs.get(conversationId) ?? 0) + 1,
    )
    this.inactiveConversations.delete(conversationId)
  }

  isOperationCurrent(token: MessageOperationToken): boolean {
    return (
      this.scopeActive &&
      token.scopeEpoch === this.scopeEpoch &&
      !this.inactiveConversations.has(token.conversationId) &&
      token.conversationEpoch === (this.conversationEpochs.get(token.conversationId) ?? 0)
    )
  }

  assertOperationCurrent(token: MessageOperationToken): void {
    if (!this.isOperationCurrent(token)) {
      throw new MessageOperationCancelledError(token.conversationId)
    }
  }

  async hydrateRecent(token: MessageOperationToken, limit: number): Promise<ClientMessage[]> {
    await this.awaitScopeBarrier(token)
    this.assertOperationCurrent(token)
    if (this.persistentCacheDisabled) throw new Error("本进程已切换为内存消息模式")
    const { conversationId } = token
    const page = await this.repository.readRecent(conversationId, limit)
    this.assertOperationCurrent(token)
    const messages = page.messages
      .map(deserializeMessage)
      .filter((message): message is ClientMessage => message !== null)
    return this.enqueue(token, async () => {
      const next = this.workingSet.merge(conversationId, messages, (message) =>
        this.tombstones.has(conversationId, message.id),
      )
      this.publish({ conversationId, kind: "messages-changed", messages: next })
      return next
    })
  }

  async hydrateBefore(
    token: MessageOperationToken,
    beforeSeq: number,
    limit: number,
  ): Promise<{ hasMoreBefore: boolean; hit: boolean; messages: ClientMessage[] }> {
    await this.awaitScopeBarrier(token)
    this.assertOperationCurrent(token)
    if (this.persistentCacheDisabled) throw new Error("本进程已切换为内存消息模式")
    const { conversationId } = token
    const page = await this.repository.readBefore(conversationId, beforeSeq, limit)
    this.assertOperationCurrent(token)
    const cached = page.messages
      .map(deserializeMessage)
      .filter((message): message is ClientMessage => message !== null)
    const complete = page.complete && cached.length === page.messages.length
    const messages = await this.enqueue(token, async () => {
      const next = this.workingSet.merge(conversationId, cached, (message) =>
        this.tombstones.has(conversationId, message.id),
      )
      if (cached.length > 0)
        this.publish({ conversationId, kind: "messages-changed", messages: next })
      return next
    })
    return {
      hasMoreBefore: page.hasMoreBefore,
      hit: complete && (cached.length > 0 || !page.hasMoreBefore),
      messages,
    }
  }

  async getSyncCursor(token: MessageOperationToken, fallback = 0): Promise<number> {
    await this.awaitScopeBarrier(token)
    const { conversationId } = token
    this.assertOperationCurrent(token)
    if (this.persistentCacheDisabled) {
      return this.memoryCursors.get(conversationId) ?? fallback
    }
    try {
      const state = await this.repository.getSyncState(conversationId)
      this.assertOperationCurrent(token)
      return Math.max(state.httpSyncedThroughSeq, this.memoryCursors.get(conversationId) ?? 0)
    } catch {
      this.assertOperationCurrent(token)
      return Math.max(fallback, this.memoryCursors.get(conversationId) ?? 0)
    }
  }

  async listSyncStates() {
    await this.scopeBarrier
    if (this.persistentCacheDisabled) return []
    return this.repository.listSyncStates()
  }

  ingest(
    source: Exclude<MessageSource, "after" | "before" | "cache" | "latest">,
    messages: ReadonlyArray<ClientMessage>,
  ): Promise<ClientMessage[]> {
    const conversationId = messages[0]?.conversationId
    if (!conversationId || messages.some((message) => message.conversationId !== conversationId)) {
      return Promise.resolve([])
    }
    let token: MessageOperationToken
    try {
      token = this.beginConversationOperation(conversationId)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueue(token, async () => {
      const acceptedMessages = messages.filter(
        (message) => !this.tombstones.has(conversationId, message.id),
      )
      const next = this.workingSet.merge(conversationId, acceptedMessages)
      this.publish({ conversationId, kind: "messages-changed", messages: next })
      const history = this.historyWindows.updateExisting(conversationId, acceptedMessages)
      if (history) {
        this.publish({ conversationId, kind: "history-window-changed", snapshot: history })
      }
      if (this.persistentCacheDisabled) return next
      try {
        const generation = await this.operationGeneration(token)
        this.assertOperationCurrent(token)
        const mergedRecords = acceptedMessages
          .map((message) => next.find((candidate) => candidate.id === message.id))
          .filter((message): message is ClientMessage => message !== undefined)
        if (mergedRecords.length > 0)
          await this.repository.upsert(conversationId, mergedRecords, generation)
        this.assertOperationCurrent(token)
      } catch {
        this.assertOperationCurrent(token)
        this.disablePersistentCache(conversationId)
      }
      return next
    })
  }

  async persist(messages: ReadonlyArray<ClientMessage>): Promise<void> {
    const conversationId = messages[0]?.conversationId
    if (!conversationId || messages.some((message) => message.conversationId !== conversationId))
      return
    const token = this.beginConversationOperation(conversationId)
    await this.enqueue(token, async () => {
      const acceptedMessages = messages.filter(
        (message) => !this.tombstones.has(conversationId, message.id),
      )
      if (acceptedMessages.length === 0 || this.persistentCacheDisabled) return
      try {
        const generation = await this.operationGeneration(token)
        this.assertOperationCurrent(token)
        const mergedRecords = await Promise.all(
          acceptedMessages.map(async (message) =>
            preserveNewerMessageState(
              (await this.repository.getById(conversationId, message.id)) ?? undefined,
              message,
            ),
          ),
        )
        this.assertOperationCurrent(token)
        await this.repository.upsert(conversationId, mergedRecords, generation)
        this.assertOperationCurrent(token)
      } catch {
        this.assertOperationCurrent(token)
        this.disablePersistentCache(conversationId)
      }
    })
  }

  compact(conversationId: string, limit: number): void {
    this.workingSet.compact(conversationId, limit)
  }

  async commitLatest(
    token: MessageOperationToken,
    messages: ReadonlyArray<ClientMessage>,
    page: ClientMessagePage,
  ): Promise<ClientMessage[]> {
    const { conversationId } = token
    return this.enqueue(token, async () => {
      const next = this.workingSet.merge(conversationId, messages, (message) =>
        this.tombstones.has(conversationId, message.id),
      )
      this.publish({ conversationId, kind: "messages-changed", messages: next })
      const latestSeq = messages.reduce((maximum, message) => Math.max(maximum, message.seq), 0)
      if (this.persistentCacheDisabled) {
        if (!this.memoryCursors.has(conversationId)) {
          this.memoryCursors.set(conversationId, latestSeq)
        }
        return next
      }
      let persistedCursor: number | undefined
      try {
        const state = await this.repository.getSyncState(conversationId)
        const generation = await this.operationGeneration(token)
        this.assertOperationCurrent(token)
        persistedCursor = state.httpSyncedThroughSeq
        const committed = await this.repository.commitLatest(
          conversationId,
          next.filter((message) => messages.some((candidate) => candidate.id === message.id)),
          page.hasMoreBefore,
          generation,
        )
        this.assertOperationCurrent(token)
        this.memoryCursors.set(conversationId, committed.committedSeq)
      } catch {
        this.assertOperationCurrent(token)
        this.memoryCursors.set(
          conversationId,
          persistedCursor === undefined || persistedCursor === 0 ? latestSeq : persistedCursor,
        )
        this.disablePersistentCache(conversationId)
      }
      return next
    })
  }

  async commitBefore(
    token: MessageOperationToken,
    beforeSeq: number,
    messages: ReadonlyArray<ClientMessage>,
    page: ClientMessagePage,
  ): Promise<ClientMessage[]> {
    const { conversationId } = token
    return this.enqueue(token, async () => {
      const next = this.workingSet.merge(conversationId, messages, (message) =>
        this.tombstones.has(conversationId, message.id),
      )
      this.publish({ conversationId, kind: "messages-changed", messages: next })
      if (this.persistentCacheDisabled) return next
      try {
        const generation = await this.operationGeneration(token)
        this.assertOperationCurrent(token)
        await this.repository.commitBefore(
          conversationId,
          beforeSeq,
          messages,
          page.hasMoreBefore,
          generation,
        )
        this.assertOperationCurrent(token)
      } catch {
        this.assertOperationCurrent(token)
        this.disablePersistentCache(conversationId)
      }
      return next
    })
  }

  catchUp(
    token: MessageOperationToken,
    afterSeq: number,
    fetchPage: (afterSeq: number) => Promise<CatchUpPage>,
    hooks: MessageCatchUpHooks = {},
  ): Promise<number> {
    const { conversationId } = token
    this.assertOperationCurrent(token)
    const flightKey = `${conversationId}:${token.scopeEpoch}:${token.conversationEpoch}`
    return this.singleFlight.run(flightKey, async () => {
      await this.awaitScopeBarrier(token)
      return catchUpConversationMessages({
        afterSeq,
        conversationId,
        fetchPage: async (cursor) => {
          this.assertOperationCurrent(token)
          const result = await fetchPage(cursor)
          this.assertOperationCurrent(token)
          return result
        },
        commit: async (result, requestAfterSeq) => {
          this.assertOperationCurrent(token)
          const visible = await this.enqueue(token, async () => {
            const next = this.workingSet.merge(conversationId, result.messages, (message) =>
              this.tombstones.has(conversationId, message.id),
            )
            this.publish({ conversationId, kind: "messages-changed", messages: next })
            return next
          })
          this.assertOperationCurrent(token)
          const pageMessages = visible.filter((message) =>
            result.messages.some((candidate) => candidate.id === message.id),
          )
          const memoryCursor = pageMessages.reduce(
            (maximum, message) => Math.max(maximum, message.seq),
            requestAfterSeq,
          )
          if (this.persistentCacheDisabled) {
            this.memoryCursors.set(conversationId, memoryCursor)
            hooks.onCacheCommitted?.({
              committedSeq: memoryCursor,
              page: result,
              requestAfterSeq,
            })
            return memoryCursor
          }
          try {
            const generation = await this.operationGeneration(token)
            this.assertOperationCurrent(token)
            const committed = await this.repository.commitAfter(
              conversationId,
              requestAfterSeq,
              pageMessages,
              result.page.hasMoreBefore,
              generation,
            )
            this.assertOperationCurrent(token)
            this.memoryCursors.set(conversationId, committed.committedSeq)
            hooks.onCacheCommitted?.({
              committedSeq: committed.committedSeq,
              page: result,
              requestAfterSeq,
            })
            return committed.committedSeq
          } catch {
            this.assertOperationCurrent(token)
            this.memoryCursors.set(conversationId, memoryCursor)
            this.disablePersistentCache(conversationId)
            hooks.onCacheCommitFailed?.({
              committedSeq: memoryCursor,
              page: result,
              requestAfterSeq,
            })
            return memoryCursor
          }
        },
      })
    })
  }

  async applyReaction(event: MessageReactionsUpdatedEvent, currentUserId: string): Promise<void> {
    await this.updatePersisted(event.conversationId, event.messageId, (message) =>
      applyMessageReactionsUpdate(message, event, currentUserId),
    )
  }

  async applyReactionSnapshot(snapshot: MessageReactionSnapshot): Promise<void> {
    await this.updatePersisted(snapshot.conversationId, snapshot.messageId, (message) =>
      applyMessageReactionSnapshot(message, snapshot),
    )
  }

  async applyChoice(
    snapshot: MessageChoiceSnapshot,
    expectedChoice?: ClientMessage["choice"],
  ): Promise<void> {
    if (snapshot.status === "deleted") {
      await this.deleteMessage(snapshot.conversationId, snapshot.messageId)
      return
    }
    await this.updatePersisted(
      snapshot.conversationId,
      snapshot.messageId,
      (message) =>
        applyMessageChoiceSnapshot(
          message,
          snapshot,
          expectedChoice === undefined ? undefined : { expectedChoice },
        ) ?? message,
    )
  }

  async applyChoiceUpdate(event: MessageChoiceUpdatedEvent, currentUserId: string): Promise<void> {
    await this.updatePersisted(event.conversationId, event.messageId, (message) =>
      applyMessageChoiceState(message, {
        ...event.choice,
        myOptionIds:
          event.actorUserId === currentUserId
            ? event.actorOptionIds
            : (message.choice?.myOptionIds ?? []),
      }),
    )
  }

  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    const token = this.beginConversationOperation(conversationId)
    this.tombstones.add(conversationId, messageId)
    await this.enqueue(token, async () => {
      const next = this.workingSet.remove(conversationId, messageId)
      this.publish({ conversationId, kind: "messages-changed", messages: next })
      const history = this.historyWindows.remove(conversationId, messageId)
      if (history) {
        this.publish({ conversationId, kind: "history-window-changed", snapshot: history })
      }
      if (this.persistentCacheDisabled) return
      try {
        const generation = await this.operationGeneration(token)
        this.assertOperationCurrent(token)
        await this.repository.remove(conversationId, messageId, generation)
        this.assertOperationCurrent(token)
      } catch {
        this.assertOperationCurrent(token)
        this.disablePersistentCache(conversationId)
      }
    })
  }

  async clearConversation(conversationId: string): Promise<void> {
    this.invalidateConversation(conversationId)
    this.workingSet.clearConversation(conversationId)
    this.historyWindows.clearConversation(conversationId)
    this.memoryCursors.delete(conversationId)
    this.tombstones.clearConversation(conversationId)
    this.publish({ conversationId, kind: "conversation-cleared" })
    const pending = this.queues.get(conversationId)
    if (pending) await pending
    await this.repository.clearConversation(conversationId)
  }

  async clear(): Promise<void> {
    this.scopeActive = false
    this.scopeEpoch += 1
    this.workingSet.clear()
    this.historyWindows.clear()
    this.memoryCursors.clear()
    this.tombstones.clear()
    this.publish({ kind: "scope-cleared" })
    await Promise.allSettled([...this.queues.values()])
    this.queues.clear()
    await this.scopeBarrier
    await this.repository.clear()
  }

  clearPersistentCache(): Promise<void> {
    this.scopeEpoch += 1
    this.memoryCursors.clear()
    const pendingQueues = [...this.queues.values()]
    const clearResult = this.scopeBarrier.then(async () => {
      await Promise.allSettled(pendingQueues)
      await this.repository.clear()
    })
    this.scopeBarrier = clearResult.then(
      () => undefined,
      () => undefined,
    )
    return clearResult
  }

  private async updatePersisted(
    conversationId: string,
    messageId: string,
    updater: (message: ClientMessage) => ClientMessage,
  ): Promise<void> {
    const token = this.beginConversationOperation(conversationId)
    await this.enqueue(token, async () => {
      const inMemory = this.workingSet
        .get(conversationId)
        .find((message) => message.id === messageId)
      const inHistory = this.historyWindows
        .get(conversationId)
        .messages.find((message) => message.id === messageId)
      let current = inMemory ?? inHistory
      if (!current && !this.persistentCacheDisabled) {
        try {
          current = (await this.repository.getById(conversationId, messageId)) ?? undefined
        } catch {
          this.assertOperationCurrent(token)
          this.disablePersistentCache(conversationId)
          return
        }
      }
      this.assertOperationCurrent(token)
      if (!current || this.tombstones.has(conversationId, messageId)) return
      const nextMessage = updater(current)
      const next = this.workingSet.update(conversationId, messageId, () => nextMessage)
      if (inMemory) this.publish({ conversationId, kind: "messages-changed", messages: next })
      const history = this.historyWindows.update(conversationId, messageId, () => nextMessage)
      if (history) {
        this.publish({ conversationId, kind: "history-window-changed", snapshot: history })
      }
      if (this.persistentCacheDisabled) return
      try {
        const generation = await this.operationGeneration(token)
        this.assertOperationCurrent(token)
        await this.repository.upsert(conversationId, [nextMessage], generation)
        this.assertOperationCurrent(token)
      } catch {
        this.assertOperationCurrent(token)
        this.disablePersistentCache(conversationId)
      }
    })
  }

  private enqueue<T>(token: MessageOperationToken, operation: () => Promise<T>): Promise<T> {
    this.assertOperationCurrent(token)
    const { conversationId } = token
    const previous = this.queues.get(conversationId) ?? Promise.resolve()
    const barrier = this.scopeBarrier
    const run = async () => {
      await barrier
      this.assertOperationCurrent(token)
      return operation()
    }
    const result = previous.then(run, run)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.queues.set(conversationId, settled)
    return result.finally(() => {
      if (this.queues.get(conversationId) === settled) this.queues.delete(conversationId)
    })
  }

  private commitHistoryWindow(
    token: MessageOperationToken,
    messages: ReadonlyArray<ClientMessage>,
    guard: HistoryRequestGuard | undefined,
    commit: (accepted: ReadonlyArray<ClientMessage>) => HistoryWindowSnapshot,
  ): Promise<HistoryWindowSnapshot> {
    const { conversationId } = token
    if (messages.some((message) => message.conversationId !== conversationId)) {
      return Promise.reject(new Error("历史窗口消息会话不一致"))
    }
    return this.enqueue(token, async () => {
      this.assertHistoryRequestCurrent(token, guard)
      const accepted = messages.filter(
        (message) => !this.tombstones.has(conversationId, message.id),
      )
      let snapshotMessages = accepted
      if (!this.persistentCacheDisabled && accepted.length > 0) {
        try {
          const generation = await this.operationGeneration(token)
          this.assertHistoryRequestCurrent(token, guard)
          const mergedRecords = await Promise.all(
            accepted.map(async (message) => {
              const persisted = await this.repository.getById(conversationId, message.id)
              this.assertHistoryRequestCurrent(token, guard)
              return preserveNewerMessageState(persisted ?? undefined, message)
            }),
          )
          snapshotMessages = mergedRecords
          this.assertHistoryRequestCurrent(token, guard)
          await this.repository.upsert(conversationId, mergedRecords, generation)
          this.assertHistoryRequestCurrent(token, guard)
        } catch {
          this.assertHistoryRequestCurrent(token, guard)
          this.disablePersistentCache(conversationId)
        }
      }
      this.assertHistoryRequestCurrent(token, guard)
      const snapshot = commit(snapshotMessages)
      this.publish({ conversationId, kind: "history-window-changed", snapshot })
      return snapshot
    })
  }

  private assertHistoryRequestCurrent(
    token: MessageOperationToken,
    guard: HistoryRequestGuard | undefined,
  ): void {
    this.assertOperationCurrent(token)
    if (guard && !guard()) throw new MessageOperationCancelledError(token.conversationId)
  }

  private async awaitScopeBarrier(token: MessageOperationToken): Promise<void> {
    const barrier = this.scopeBarrier
    await barrier
    this.assertOperationCurrent(token)
  }

  private async operationGeneration(token: MessageOperationToken) {
    const generation = await token.generation
    this.assertOperationCurrent(token)
    if (!generation) throw new Error("消息缓存 generation 不可用")
    return generation
  }

  private disablePersistentCache(conversationId: string): void {
    if (this.persistentCacheDisabled) return
    this.persistentCacheDisabled = true
    this.publish({ conversationId, errorCode: "cache", kind: "sync-error" })
  }

  private publish(event: MessageManagerEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private invalidateConversation(conversationId: string): void {
    this.conversationEpochs.set(
      conversationId,
      (this.conversationEpochs.get(conversationId) ?? 0) + 1,
    )
    this.inactiveConversations.add(conversationId)
  }
}
