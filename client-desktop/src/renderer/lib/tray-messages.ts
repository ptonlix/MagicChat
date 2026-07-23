import type { ClientConversation } from "@/lib/client-data-api"
import type { TrayMessageInput } from "@/lib/desktop-host"

const maximumTrayMessages = 5
const maximumConversationNameLength = 16
const maximumMessageSummaryLength = 24

export function selectLatestTrayMessages(
  conversations: ReadonlyArray<ClientConversation>,
): TrayMessageInput[] {
  return conversations
    .filter((conversation) => conversation.lastMessageAt !== null)
    .toSorted(
      (left, right) => Date.parse(right.lastMessageAt ?? "") - Date.parse(left.lastMessageAt ?? ""),
    )
    .slice(0, maximumTrayMessages)
    .map((conversation) => ({
      conversationId: conversation.id,
      name: singleLine(conversation.name, maximumConversationNameLength) || "未命名会话",
      summary: singleLine(conversation.lastMessageSummary, maximumMessageSummaryLength) || "新消息",
      unreadCount: conversation.unreadCount,
    }))
}

function singleLine(value: string, maximumLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  const characters = Array.from(normalized)
  if (characters.length <= maximumLength) return normalized
  return `${characters.slice(0, maximumLength - 1).join("")}…`
}
