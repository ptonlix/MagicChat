import { describe, expect, it, vi } from "vitest"
import type { ClientMessage } from "@/lib/client-data-api"
import type {
  MessageCacheGeneration,
  MessageCachePage,
  MessageCacheRecord,
  MessageCacheSyncState,
  MessageCacheWindowPage,
} from "@shared/message-cache-contract"
import { MessageManager } from "./message-manager"
import { MessageOperationCancelledError } from "./message-operation"
import type { MessageRepository } from "./message-repository"
import { serializeMessage } from "./message-serializer"

const generation: MessageCacheGeneration = { conversation: 0, global: 0, server: 0, user: 0 }

describe("MessageManager", () => {
  it("缓存、HTTP 和实时乱序到达时保持唯一并保护新版状态", async () => {
    const repository = new FakeRepository([message(2, { reactionVersion: 3 })])
    const manager = new MessageManager(repository)
    const operation = manager.beginConversationOperation("conversation-1")
    await manager.hydrateRecent(operation, 20)
    await manager.commitLatest(operation, [message(1), message(2, { reactionVersion: 1 })], page())
    await manager.ingest("realtime", [message(3), message(2, { reactionVersion: 2 })])

    expect(manager.getMessages("conversation-1").map(({ seq }) => seq)).toEqual([1, 2, 3])
    expect(manager.getMessages("conversation-1")[1].reactionVersion).toBe(3)
  })

  it("删除 tombstone 阻止迟到页面复活消息", async () => {
    const repository = new FakeRepository([message(1)])
    const manager = new MessageManager(repository)
    await manager.hydrateRecent(manager.beginConversationOperation("conversation-1"), 20)
    await manager.deleteMessage("conversation-1", "message-1")
    await manager.ingest("realtime", [message(1)])
    expect(manager.getMessages("conversation-1")).toEqual([])
  })

  it("reaction 可以更新仅存在于持久缓存的工作集外消息", async () => {
    const repository = new FakeRepository([message(1)])
    const manager = new MessageManager(repository)
    await manager.applyReaction(
      {
        actorReacted: true,
        actorText: "ok",
        actorUserId: "user-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        reactionVersion: 1,
        reactions: [{ count: 1, text: "ok", users: [] }],
      },
      "user-1",
    )
    expect(repository.records[0]).toMatchObject({ reactionVersion: 1 })
  })

  it("历史缓存页包含结构损坏记录时保留有效消息但要求回源", async () => {
    const repository = new FakeRepository([message(1), message(2)])
    const valid = serializeMessage(message(1))
    repository.beforePageOverride = {
      complete: true,
      hasMoreBefore: false,
      messages: [valid, { ...serializeMessage(message(2)), payloadJson: "{}" }],
      newestSeq: 2,
      oldestSeq: 1,
    }
    const manager = new MessageManager(repository)

    const result = await manager.hydrateBefore(
      manager.beginConversationOperation("conversation-1"),
      3,
      20,
    )

    expect(result.hit).toBe(false)
    expect(result.messages.map(({ id }) => id)).toEqual(["message-1"])
  })

  it("两个 manager 的工作集互不共享", async () => {
    const first = new MessageManager(new FakeRepository([]))
    const second = new MessageManager(new FakeRepository([]))
    await first.ingest("local", [message(1)])
    expect(first.getMessages("conversation-1")).toHaveLength(1)
    expect(second.getMessages("conversation-1")).toHaveLength(0)
  })

  it("实时消息和失败的最新页写入都不能跳过持久连续游标", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    let operation = manager.beginConversationOperation("conversation-1")
    await manager.commitLatest(operation, [message(100)], page())
    await manager.ingest("realtime", [message(105)])

    expect(await manager.getSyncCursor(operation, 105)).toBe(100)

    repository.failLatestCommit = true
    operation = manager.beginConversationOperation("conversation-1")
    await manager.commitLatest(operation, [message(106)], page())
    expect(await manager.getSyncCursor(operation, 106)).toBe(100)
  })

  it("持久写入失败后本进程固定使用内存模式且不再访问缓存", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    repository.failLatestCommit = true

    await manager.commitLatest(
      manager.beginConversationOperation("conversation-1"),
      [message(100)],
      page(),
    )
    repository.failLatestCommit = false
    await manager.ingest("realtime", [message(101)])

    expect(manager.getMessages("conversation-1").map(({ seq }) => seq)).toEqual([100, 101])
    expect(repository.records).toEqual([])
    expect(repository.upsertCalls).toBe(0)
    expect(await manager.listSyncStates()).toEqual([])
    await expect(
      manager.hydrateRecent(manager.beginConversationOperation("conversation-1"), 20),
    ).rejects.toThrow("本进程已切换为内存消息模式")
    expect(repository.readRecentCalls).toBe(0)
  })

  it("追赶时 generation 不可用仍展示消息并切换为内存模式", async () => {
    const repository = new FakeRepository([])
    repository.failSyncState = true
    const manager = new MessageManager(repository)
    const events: string[] = []
    manager.subscribe((event) => events.push(event.kind))

    const cursor = await manager.catchUp(
      manager.beginConversationOperation("conversation-1"),
      0,
      async () => ({ messages: [message(1)], page: page() }),
    )
    repository.failSyncState = false
    await manager.ingest("local", [message(2)])

    expect(cursor).toBe(1)
    expect(manager.getMessages("conversation-1").map(({ seq }) => seq)).toEqual([1, 2])
    expect(repository.records).toEqual([])
    expect(events).toContain("sync-error")
  })

  it("追赶缓存提交失败时只报告缓存失败，不伪装为提交成功", async () => {
    const repository = new FakeRepository([])
    repository.failAfterCommit = true
    const manager = new MessageManager(repository)
    const committed: number[] = []
    const failures: number[] = []

    const cursor = await manager.catchUp(
      manager.beginConversationOperation("conversation-1"),
      0,
      async () => ({ messages: [message(1)], page: page() }),
      {
        onCacheCommitFailed: ({ committedSeq }) => failures.push(committedSeq),
        onCacheCommitted: ({ committedSeq }) => committed.push(committedSeq),
      },
    )

    expect(cursor).toBe(1)
    expect(committed).toEqual([])
    expect(failures).toEqual([1])
    expect(manager.getMessages("conversation-1").map(({ seq }) => seq)).toEqual([1])
  })

  it("会话清理使挂起的追赶响应失效且不会复活 UI、缓存或游标", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    const events: string[] = []
    manager.subscribe((event) => events.push(event.kind))
    const response = deferred<{ messages: ClientMessage[]; page: ReturnType<typeof page> }>()
    const operation = manager.beginConversationOperation("conversation-1")
    const catchUp = manager.catchUp(operation, 0, () => response.promise)

    await manager.clearConversation("conversation-1")
    response.resolve({ messages: [message(1)], page: page() })

    await expect(catchUp).rejects.toBeInstanceOf(MessageOperationCancelledError)
    expect(manager.getMessages("conversation-1")).toEqual([])
    expect(repository.records).toEqual([])
    expect(events).toEqual(["conversation-cleared"])
  })

  it("操作启动时捕获 generation，Main 清理后的迟到响应不能重新落盘", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    const operation = manager.beginConversationOperation("conversation-1")
    await operation.generation

    await repository.clear()
    await manager.commitLatest(operation, [message(1)], page())

    expect(repository.records).toEqual([])
  })

  it("会话清理使请求前捕获的 latest token 失效", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    const operation = manager.beginConversationOperation("conversation-1")

    await manager.clearConversation("conversation-1")

    await expect(manager.commitLatest(operation, [message(1)], page())).rejects.toBeInstanceOf(
      MessageOperationCancelledError,
    )
    expect(repository.records).toEqual([])
    expect(manager.getMessages("conversation-1")).toEqual([])
  })

  it("会话清理等待已排队 mutation 退出后再清库", async () => {
    const repository = new FakeRepository([message(1)])
    const manager = new MessageManager(repository)
    const read = deferred<ClientMessage | null>()
    repository.getByIdOverride = () => read.promise
    const mutation = manager.applyReactionSnapshot({
      conversationId: "conversation-1",
      messageId: "message-1",
      reactionVersion: 1,
      reactions: [],
    })

    const clearing = manager.clearConversation("conversation-1")
    read.resolve(message(1))

    await expect(mutation).rejects.toBeInstanceOf(MessageOperationCancelledError)
    await clearing
    expect(repository.records).toEqual([])
    expect(repository.clearConversationCalls).toBe(1)
  })

  it("清理后拒绝新的实时写入，权威恢复后仅接受新 epoch 操作", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    const oldOperation = manager.beginConversationOperation("conversation-1")
    await manager.clearConversation("conversation-1")

    await expect(manager.ingest("realtime", [message(1)])).rejects.toBeInstanceOf(
      MessageOperationCancelledError,
    )

    manager.activateConversation("conversation-1")
    await expect(manager.commitLatest(oldOperation, [message(1)], page())).rejects.toBeInstanceOf(
      MessageOperationCancelledError,
    )
    const newOperation = manager.beginConversationOperation("conversation-1")
    manager.activateConversation("conversation-1")
    expect(manager.isOperationCurrent(newOperation)).toBe(true)
    await manager.commitLatest(newOperation, [message(2)], page())
    expect(manager.getMessages("conversation-1").map(({ id }) => id)).toEqual(["message-2"])
  })

  it("作用域清理使全部旧 token 和后续写入失效", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    const operation = manager.beginConversationOperation("conversation-1")

    await manager.clear()

    expect(() => manager.assertOperationCurrent(operation)).toThrow(MessageOperationCancelledError)
    await expect(manager.ingest("local", [message(1)])).rejects.toBeInstanceOf(
      MessageOperationCancelledError,
    )
    expect(repository.records).toEqual([])
  })

  it("设置清理保留工作集、使旧操作失效并让新写入等待清理完成", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    await manager.ingest("local", [message(1)])
    const oldOperation = manager.beginConversationOperation("conversation-1")
    const clearGate = deferred<void>()
    repository.clearOverride = () => clearGate.promise

    const clearing = manager.clearPersistentCache()
    const ingesting = manager.ingest("local", [message(2)])

    await expect(manager.commitLatest(oldOperation, [message(3)], page())).rejects.toBeInstanceOf(
      MessageOperationCancelledError,
    )
    expect(manager.getMessages("conversation-1").map(({ seq }) => seq)).toEqual([1])
    expect(repository.records.map(({ seq }) => seq)).toEqual([1])

    clearGate.resolve()
    await clearing
    await ingesting

    expect(repository.clearCalls).toBe(1)
    expect(manager.getMessages("conversation-1").map(({ seq }) => seq)).toEqual([1, 2])
    expect(repository.records.map(({ seq }) => seq)).toEqual([2])
  })

  it("设置清理期间启动的新追赶等待清理完成", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository)
    const clearGate = deferred<void>()
    repository.clearOverride = () => clearGate.promise
    const clearing = manager.clearPersistentCache()
    const fetchPage = vi.fn().mockResolvedValue({ messages: [message(1)], page: page() })

    const catchUp = manager.catchUp(
      manager.beginConversationOperation("conversation-1"),
      0,
      fetchPage,
    )
    await Promise.resolve()
    expect(fetchPage).not.toHaveBeenCalled()

    clearGate.resolve()
    await clearing
    await catchUp

    expect(fetchPage).toHaveBeenCalledOnce()
    expect(repository.records.map(({ seq }) => seq)).toEqual([1])
  })
  it("历史窗口独立持久化且不推进连续游标或 latest working set", async () => {
    const repository = new FakeRepository([])
    const manager = new MessageManager(repository, 3)
    const operation = manager.beginConversationOperation("conversation-1")
    const cursorBefore = await manager.getSyncCursor(operation)

    const snapshot = await manager.replaceHistoryWindow(
      operation,
      { messageId: "message-2", seq: 2 },
      [message(1), message(2), message(3)],
      { hasMoreAfter: true, hasMoreBefore: true },
    )

    expect(snapshot.messages.map(({ seq }) => seq)).toEqual([1, 2, 3])
    expect(manager.getMessages("conversation-1")).toEqual([])
    expect(await manager.getSyncCursor(operation)).toBe(cursorBefore)
    expect(repository.upsertCalls).toBe(1)
  })

  it("实时消息只更新历史窗口已有实体，删除同时协调两个集合", async () => {
    const manager = new MessageManager(new FakeRepository([]), 3)
    const operation = manager.beginConversationOperation("conversation-1")
    await manager.replaceHistoryWindow(
      operation,
      { messageId: "message-2", seq: 2 },
      [message(1), message(2)],
      { hasMoreAfter: true, hasMoreBefore: false },
    )
    await manager.ingest("realtime", [message(3)])
    expect(manager.getHistoryWindow("conversation-1").messages.map(({ seq }) => seq)).toEqual([
      1, 2,
    ])

    await manager.ingest("realtime", [
      message(2, {
        body: { editableBody: { content: "重发", type: "text" }, type: "revoked" },
      }),
    ])
    expect(manager.getHistoryWindow("conversation-1").messages.at(-1)?.body).toMatchObject({
      type: "revoked",
    })
    await manager.deleteMessage("conversation-1", "message-2")
    expect(manager.getHistoryWindow("conversation-1").messages.map(({ seq }) => seq)).toEqual([1])
    expect(manager.getMessages("conversation-1").some(({ id }) => id === "message-2")).toBe(false)
  })
})

class FakeRepository implements MessageRepository {
  beforePageOverride?: MessageCachePage
  clearCalls = 0
  clearConversationCalls = 0
  clearOverride?: () => Promise<void>
  failLatestCommit = false
  failAfterCommit = false
  failSyncState = false
  getByIdOverride?: () => Promise<ClientMessage | null>
  readRecentCalls = 0
  records: ClientMessage[]
  upsertCalls = 0
  private syncState: MessageCacheSyncState = {
    conversationId: "conversation-1",
    generation,
    hasMoreBefore: true,
    httpSyncedThroughSeq: 0,
    lastAccessedAt: 0,
  }

  constructor(records: ClientMessage[]) {
    this.records = records
  }

  async clear() {
    this.clearCalls += 1
    await this.clearOverride?.()
    this.records = []
    this.syncState = {
      ...this.syncState,
      generation: {
        ...this.syncState.generation,
        global: this.syncState.generation.global + 1,
      },
      httpSyncedThroughSeq: 0,
    }
  }
  async clearConversation() {
    this.clearConversationCalls += 1
    this.records = []
    return generation
  }
  async commitAfter(
    _id: string,
    _seq: number,
    records: ReadonlyArray<ClientMessage>,
    _hasMoreBefore: boolean,
    expectedGeneration: MessageCacheGeneration,
  ) {
    this.assertGeneration(expectedGeneration)
    if (this.failAfterCommit) throw new Error("cache unavailable")
    this.records = merge(this.records, records)
    const committedSeq = this.records.at(-1)?.seq ?? 0
    this.syncState = { ...this.syncState, httpSyncedThroughSeq: committedSeq }
    return { committed: true, committedSeq, generation: this.syncState.generation }
  }
  async commitBefore(
    _id: string,
    _seq: number,
    records: ReadonlyArray<ClientMessage>,
    _hasMoreBefore: boolean,
    expectedGeneration: MessageCacheGeneration,
  ) {
    this.assertGeneration(expectedGeneration)
    this.records = merge(this.records, records)
    return {
      committed: true,
      committedSeq: this.syncState.httpSyncedThroughSeq,
      generation: this.syncState.generation,
    }
  }
  async commitLatest(
    _id: string,
    records: ReadonlyArray<ClientMessage>,
    _hasMoreBefore: boolean,
    expectedGeneration: MessageCacheGeneration,
  ) {
    this.assertGeneration(expectedGeneration)
    if (this.failLatestCommit) throw new Error("cache unavailable")
    this.records = merge(this.records, records)
    const committedSeq = this.records.at(-1)?.seq ?? 0
    this.syncState = { ...this.syncState, httpSyncedThroughSeq: committedSeq }
    return { committed: true, committedSeq, generation: this.syncState.generation }
  }
  async getById(_conversationId: string, messageId: string) {
    if (this.getByIdOverride) return this.getByIdOverride()
    return this.records.find((record) => record.id === messageId) ?? null
  }
  async getStats() {
    return {
      conversationCount: this.records.length ? 1 : 0,
      messageCount: this.records.length,
      payloadBytes: 0,
      status: "available" as const,
    }
  }
  async getSyncState() {
    if (this.failSyncState) throw new Error("cache unavailable")
    return this.syncState
  }
  async listSyncStates() {
    return [this.syncState]
  }
  async readBefore(_id: string, beforeSeq: number) {
    if (this.beforePageOverride) return this.beforePageOverride
    return cachePage(this.records.filter((record) => record.seq < beforeSeq))
  }
  async readAround(_id: string, targetSeq: number, limit: number): Promise<MessageCacheWindowPage> {
    const sorted = this.records
      .filter((record) => Math.abs(record.seq - targetSeq) <= limit)
      .sort((left, right) => left.seq - right.seq)
    return {
      ...cachePage(sorted),
      complete: sorted.some((record) => record.seq === targetSeq),
      hasMoreAfter: this.records.some((record) => record.seq > (sorted.at(-1)?.seq ?? targetSeq)),
    }
  }
  async readRecent() {
    this.readRecentCalls += 1
    return cachePage(this.records)
  }
  async remove(_id: string, messageId: string, expectedGeneration: MessageCacheGeneration) {
    this.assertGeneration(expectedGeneration)
    this.records = this.records.filter((record) => record.id !== messageId)
  }
  async upsert(
    _id: string,
    records: ReadonlyArray<ClientMessage>,
    expectedGeneration: MessageCacheGeneration,
  ) {
    this.upsertCalls += 1
    this.assertGeneration(expectedGeneration)
    this.records = merge(this.records, records)
  }

  private assertGeneration(expected: MessageCacheGeneration) {
    if (JSON.stringify(expected) !== JSON.stringify(this.syncState.generation)) {
      throw new Error("cache generation is stale")
    }
  }
}

function cachePage(messages: ClientMessage[]) {
  const records = messages.map(serializeMessage)
  return {
    complete: true,
    hasMoreBefore: false,
    messages: records as MessageCacheRecord[],
    newestSeq: messages.at(-1)?.seq ?? 0,
    oldestSeq: messages[0]?.seq ?? 0,
  }
}

function merge(current: ClientMessage[], incoming: ReadonlyArray<ClientMessage>) {
  return [...new Map([...current, ...incoming].map((item) => [item.id, item])).values()].sort(
    (left, right) => left.seq - right.seq,
  )
}

function message(seq: number, patch: Partial<ClientMessage> = {}): ClientMessage {
  return {
    body: { content: String(seq), type: "text" },
    clientMessageId: `client-${seq}`,
    conversationId: "conversation-1",
    createdAt: "2026-07-29T00:00:00Z",
    id: `message-${seq}`,
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-1", type: "user" },
    seq,
    ...patch,
  } as ClientMessage
}

function page() {
  return {
    hasMoreAfter: false,
    hasMoreBefore: true,
    limit: 20,
    newestSeq: 2,
    oldestSeq: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}
