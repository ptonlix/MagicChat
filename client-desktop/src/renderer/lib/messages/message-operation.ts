export type MessageOperationToken = Readonly<{
  conversationEpoch: number
  conversationId: string
  scopeEpoch: number
}>

export class MessageOperationCancelledError extends Error {
  constructor(readonly conversationId: string) {
    super("消息操作已因作用域清理而取消")
    this.name = "MessageOperationCancelledError"
  }
}

export function isMessageOperationCancelled(
  error: unknown,
): error is MessageOperationCancelledError {
  return error instanceof MessageOperationCancelledError
}
