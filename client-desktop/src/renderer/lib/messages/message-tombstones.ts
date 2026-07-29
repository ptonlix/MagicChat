export class MessageTombstones {
  private readonly deleted = new Map<string, Set<string>>()

  add(conversationId: string, messageId: string): void {
    const ids = this.deleted.get(conversationId) ?? new Set<string>()
    ids.add(messageId)
    this.deleted.set(conversationId, ids)
  }

  has(conversationId: string, messageId: string): boolean {
    return this.deleted.get(conversationId)?.has(messageId) ?? false
  }

  clearConversation(conversationId: string): void {
    this.deleted.delete(conversationId)
  }

  clear(): void {
    this.deleted.clear()
  }
}
