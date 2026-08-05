import type { ClientConversation } from "@/lib/client-data-api"
import type { Translator } from "@/lib/i18n"

export function getConversationDefaultDescription(
  conversation: ClientConversation,
  t: Translator,
): string {
  return conversation.lastMessageSummary.trim() || t("search.noMessages")
}
