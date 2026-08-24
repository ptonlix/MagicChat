import type { ReactNode } from "react"
import { Bot, MessagesSquare, Settings, UserRound, UsersRound } from "lucide-react"

import { useLocale } from "@/components/locale-provider"
import { type ClientConversation } from "@/lib/client-data-api"
import { AddGroupMembersDialog } from "@/components/add-group-members-dialog"
import { AppProfilePopover } from "@/components/app-profile-popover"
import { ConversationAvatar } from "@/components/conversation/conversation-avatar"
import { ConversationStatusIndicator } from "@/components/conversation/conversation-status-indicator"
import { ConversationInfoDrawer } from "@/components/conversation-info-drawer"
import { GroupProfilePopover } from "@/components/group-profile-popover"
import { Button } from "@/components/ui/button"
import { UserProfilePopover } from "@/components/user-profile-popover"
import { ConversationAttachmentsDialog } from "@/components/conversation/conversation-attachments-dialog"
import { ConversationTopicsDialog } from "@/components/conversation/conversation-topics-dialog"

export function ConversationPanelHeader({
  actions,
  conversation,
  currentUserId,
  online,
  onOpenTopic,
  status,
}: {
  actions?: ReactNode
  conversation: ClientConversation
  currentUserId: string
  online?: boolean
  onOpenTopic?: (conversationId: string) => void
  status?: string
}) {
  const { t } = useLocale()
  return (
    <header
      className="conversation-panel-header-surface flex h-14 shrink-0 items-center justify-between px-5"
      data-desktop-drag-region="true"
      data-testid="conversation-panel-header"
    >
      <div className="flex min-w-0 items-center gap-3 pr-3">
        <ConversationPanelHeaderProfileAvatar
          conversation={conversation}
          currentUserId={currentUserId}
          online={online}
        />
        <div className="flex min-w-0 flex-col justify-center">
          <h2 className="min-w-0 truncate text-sm leading-5 font-medium">{conversation.name}</h2>
          {conversation.type === "group" && (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
              <UsersRound className="size-3" />
              {t("chat.header.memberCount", { count: getGroupMemberCount(conversation) })}
            </span>
          )}
          {conversation.type === "app" &&
            (status ? (
              <ConversationStatusIndicator
                announce
                className="text-xs leading-4 text-muted-foreground"
                status={status}
              />
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
                <Bot className="size-3" />
                {t("chat.header.app")}
              </span>
            ))}
          {conversation.type === "direct" &&
            (status ? (
              <ConversationStatusIndicator
                announce
                className="text-xs leading-4 text-muted-foreground"
                status={status}
              />
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
                <UserRound className="size-3" />
                {t("chat.header.privateChat")}
              </span>
            ))}
          {conversation.type === "topic" && (
            <span
              className="inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground"
              title={getTopicTypeLabel(conversation, t)}
            >
              <MessagesSquare className="size-3 shrink-0" />
              <span className="truncate">{getTopicTypeLabel(conversation, t)}</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {conversation.type !== "topic" && onOpenTopic && (
          <ConversationTopicsDialog conversation={conversation} onOpenTopic={onOpenTopic} />
        )}
        {conversation.type !== "topic" && (
          <ConversationAttachmentsDialog conversation={conversation} />
        )}
        {conversation.type === "group" && <AddGroupMembersDialog conversation={conversation} />}
        {conversation.type !== "topic" && (
          <ConversationInfoDrawer conversationId={conversation.id}>
            <Button
              aria-label={t("chat.header.settings")}
              size="icon-sm"
              title={t("chat.header.settings")}
              type="button"
              variant="ghost"
            >
              <Settings className="size-4" />
            </Button>
          </ConversationInfoDrawer>
        )}
      </div>
    </header>
  )
}

function getGroupMemberCount(conversation: ClientConversation) {
  return conversation.memberCount || conversation.members?.length || 0
}

function getTopicTypeLabel(conversation: ClientConversation, t: ReturnType<typeof useLocale>["t"]) {
  const parentConversationName = conversation.topic?.parentConversationName.trim()

  return parentConversationName
    ? t("chat.header.topicOf", { name: parentConversationName })
    : t("chat.header.topic")
}

function ConversationPanelHeaderProfileAvatar({
  conversation,
  currentUserId,
  online,
}: {
  conversation: ClientConversation
  currentUserId: string
  online?: boolean
}) {
  const { t } = useLocale()
  const avatar = <ConversationPanelHeaderAvatar conversation={conversation} online={online} />

  if (conversation.type === "topic") {
    return avatar
  }

  if (conversation.type === "group") {
    return <GroupProfilePopover conversation={conversation}>{avatar}</GroupProfilePopover>
  }

  if (conversation.type === "direct") {
    const otherMember = conversation.members?.find(
      (member) => member.type === "user" && member.id !== currentUserId,
    )

    if (!otherMember) {
      return avatar
    }

    return (
      <UserProfilePopover
        fallbackProfile={otherMember}
        triggerAriaLabel={t("chat.header.profile", { name: conversation.name })}
        userId={otherMember.id}
      >
        {avatar}
      </UserProfilePopover>
    )
  }

  const appMember = conversation.members?.find((member) => member.type === "app")
  const appId = appMember?.id ?? conversation.id

  return (
    <AppProfilePopover
      appId={appId}
      fallbackProfile={{
        avatar: appMember?.avatar || conversation.avatar,
        description: "",
        id: appId,
        name: appMember?.name || conversation.name,
        online: online ?? false,
      }}
      triggerAriaLabel={t("chat.header.profile", { name: conversation.name })}
    >
      {avatar}
    </AppProfilePopover>
  )
}

function ConversationPanelHeaderAvatar({
  conversation,
  online,
}: {
  conversation: ClientConversation
  online?: boolean
}) {
  return (
    <ConversationAvatar
      className="size-9"
      conversation={conversation}
      online={online}
      sourceAvatarClassName="size-5"
    />
  )
}
