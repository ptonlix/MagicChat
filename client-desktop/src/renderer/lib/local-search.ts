import type {
  ClientConversation,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import {
  createConversationSearchIndex,
  searchConversationIndex,
  type ConversationSearchResult,
} from "@/lib/conversation-search"
import {
  createDirectorySearchIndex,
  searchDirectoryIndex,
  type DirectorySearchItem,
} from "@/lib/directory-search"

export type LocalSearchScope = "all" | "directory" | "conversation"
export function createLocalSearchService({
  apps,
  contacts,
  conversations,
  currentUserId,
  groups,
}: {
  apps: ContactApp[]
  contacts: ContactUser[]
  conversations: ClientConversation[]
  currentUserId: string
  groups: ContactGroup[]
}) {
  const directoryIndex = createDirectorySearchIndex({
    apps,
    groups,
    users: contacts.filter((contact) => contact.id !== currentUserId),
  })
  const conversationIndex = createConversationSearchIndex(conversations, currentUserId)
  return {
    search({ keyword, scope }: { keyword: string; scope: LocalSearchScope }): {
      conversations: ConversationSearchResult[]
      directory: DirectorySearchItem[]
    } {
      if (!keyword.trim()) return { conversations: [], directory: [] }
      return {
        conversations:
          scope === "all" || scope === "conversation"
            ? searchConversationIndex(conversationIndex, keyword)
            : [],
        directory:
          scope === "all" || scope === "directory"
            ? searchDirectoryIndex(directoryIndex, keyword)
            : [],
      }
    },
  }
}

export type { ConversationSearchResult, DirectorySearchItem }
