import { describe, expect, it } from "vitest"
import type { ClientMessage } from "@/lib/client-data-api"
import type {
  MessageCacheGeneration,
  MessageCacheRecord,
  MessageCacheSyncState,
} from "@shared/message-cache-contract"
import { MessageManager } from "./message-manager"
import { MessageOperationCancelledError } from "./message-operation"
import type { MessageRepository } from "./message-repository"
import { serializeMessage } from "./message-serializer"

const generation: MessageCacheGeneration = { conversation: 0, server: 0, user: 0 }

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
})

class FakeRepository implements MessageRepository {
  clearConversationCalls = 0
  failLatestCommit = false
  getByIdOverride?: () => Promise<ClientMessage | null>
  records: ClientMessage[]
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
    this.records = []
  }
  async clearConversation() {
    this.clearConversationCalls += 1
    this.records = []
    return generation
  }
  async commitAfter(_id: string, _seq: number, records: ReadonlyArray<ClientMessage>) {
    this.records = merge(this.records, records)
    const committedSeq = this.records.at(-1)?.seq ?? 0
    this.syncState = { ...this.syncState, httpSyncedThroughSeq: committedSeq }
    return { committed: true, committedSeq, generation }
  }
  async commitBefore(_id: string, _seq: number, records: ReadonlyArray<ClientMessage>) {
    this.records = merge(this.records, records)
    return { committed: true, committedSeq: this.syncState.httpSyncedThroughSeq, generation }
  }
  async commitLatest(_id: string, records: ReadonlyArray<ClientMessage>) {
    if (this.failLatestCommit) throw new Error("cache unavailable")
    this.records = merge(this.records, records)
    const committedSeq = this.records.at(-1)?.seq ?? 0
    this.syncState = { ...this.syncState, httpSyncedThroughSeq: committedSeq }
    return { committed: true, committedSeq, generation }
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
    return this.syncState
  }
  async listSyncStates() {
    return [this.syncState]
  }
  async readBefore(_id: string, beforeSeq: number) {
    return cachePage(this.records.filter((record) => record.seq < beforeSeq))
  }
  async readRecent() {
    return cachePage(this.records)
  }
  async remove(_id: string, messageId: string) {
    this.records = this.records.filter((record) => record.id !== messageId)
  }
  async upsert(_id: string, records: ReadonlyArray<ClientMessage>) {
    this.records = merge(this.records, records)
  }
}

function cachePage(messages: ClientMessage[]) {
  const records = messages.map(serializeMessage)
  return {
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
