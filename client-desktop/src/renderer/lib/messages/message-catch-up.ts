import type { ClientMessage, ClientMessagePage } from "@/lib/client-data-api"
import { isMessageOperationCancelled } from "./message-operation"

export type MessageCatchUpErrorCode = "cache" | "network" | "protocol_cursor"

export class MessageCatchUpError extends Error {
  constructor(
    readonly code: MessageCatchUpErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "MessageCatchUpError"
  }
}

export type CatchUpPage = Readonly<{
  messages: ClientMessage[]
  page: ClientMessagePage
}>

export async function catchUpConversationMessages(options: {
  afterSeq: number
  commit(page: CatchUpPage, afterSeq: number): Promise<number>
  conversationId: string
  fetchPage(afterSeq: number): Promise<CatchUpPage>
  yieldEveryPages?: number
}): Promise<number> {
  let cursor = options.afterSeq
  let pageCount = 0
  for (;;) {
    let result: CatchUpPage
    try {
      result = await options.fetchPage(cursor)
    } catch (error) {
      if (isMessageOperationCancelled(error)) throw error
      throw new MessageCatchUpError("network", "同步消息网络请求失败", { cause: error })
    }

    if (result.messages.some((message) => message.conversationId !== options.conversationId)) {
      throw new MessageCatchUpError("protocol_cursor", "同步消息响应包含错误会话")
    }
    const advancing = result.messages.filter((message) => message.seq > cursor)
    const nextCursor = advancing.reduce(
      (maximum, message) => Math.max(maximum, message.seq),
      cursor,
    )
    if (result.page.hasMoreAfter && nextCursor <= cursor) {
      throw new MessageCatchUpError("protocol_cursor", "同步消息游标未向前推进")
    }

    try {
      cursor = await options.commit(result, cursor)
    } catch (error) {
      if (isMessageOperationCancelled(error)) throw error
      throw new MessageCatchUpError("cache", "同步消息缓存提交失败", { cause: error })
    }
    if (!result.page.hasMoreAfter) return cursor

    pageCount += 1
    if (pageCount % (options.yieldEveryPages ?? 10) === 0) await yieldToEventLoop()
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export class MessageSyncSingleFlight {
  private readonly running = new Map<string, Promise<number>>()

  run(key: string, operation: () => Promise<number>): Promise<number> {
    const existing = this.running.get(key)
    if (existing) return existing
    const current = operation().finally(() => {
      if (this.running.get(key) === current) this.running.delete(key)
    })
    this.running.set(key, current)
    return current
  }
}

export function prioritizeConversationSyncs<
  T extends {
    id: string
    lastMessageAt?: string | null
    unreadCount?: number
  },
>(items: ReadonlyArray<T>, currentConversationId?: string): T[] {
  return [...items].sort((left, right) => {
    const leftPriority = left.id === currentConversationId ? 2 : left.unreadCount ? 1 : 0
    const rightPriority = right.id === currentConversationId ? 2 : right.unreadCount ? 1 : 0
    if (leftPriority !== rightPriority) return rightPriority - leftPriority
    return (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? "")
  })
}
