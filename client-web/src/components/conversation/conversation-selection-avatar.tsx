import { GroupAvatar } from "@/components/group-avatar"
import { SelectionListAvatar } from "@/components/selection-list-avatar"
import type { ClientConversation } from "@/lib/client-data-api"

export function ConversationSelectionAvatar({
  conversation,
}: {
  conversation: ClientConversation
}) {
  if (conversation.type === "group") {
    return (
      <GroupAvatar
        avatar={conversation.avatar}
        className="size-6"
        members={conversation.members}
        name={conversation.name}
      />
    )
  }

  return (
    <SelectionListAvatar
      avatar={conversation.avatar}
      name={conversation.name}
    />
  )
}
