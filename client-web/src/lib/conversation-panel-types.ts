import type { ClientMessage } from "@/lib/client-data-api"
import type { ConversationDraftReplyTarget } from "@/lib/conversation-drafts"
import type { MentionTargetType } from "@/lib/message-mentions"

export type ConversationPanelMessage = {
  id: string
  role: "me" | "other" | "system"
  author: string
  avatar: string
  body: ClientMessage["body"]
  canRevoke: boolean
  delegatedByName: string
  mentionTarget: ConversationPanelMentionTarget | null
  replyTo?: ConversationPanelReplyTarget
  time: string
  senderAppId: string | null
  senderAppProfile: ConversationPanelAppProfile | null
  senderUserId: string | null
}

export type ConversationPanelMessageSelection = {
  active: boolean
  selectedMessageIds: ReadonlySet<string>
}

export type ConversationPanelForwardMode = "separate" | "merged"

export type ConversationPanelAppProfile = {
  avatar: string
  description: string
  id: string
  name: string
  online: boolean
}

export type ConversationPanelMentionTarget = {
  id: string
  label: string
  targetType: MentionTargetType
}

export type ConversationPanelReplyTarget = ConversationDraftReplyTarget

export type ConversationPanelComposerHandle = {
  focus: () => void
  insertMention: (target: ConversationPanelMentionTarget) => void
  openDroppedFile: (file: File) => void
}
