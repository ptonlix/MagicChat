import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { Loader2Icon, Search } from "lucide-react"
import { toast } from "sonner"

import { ConversationSelectionAvatar } from "@/components/conversation/conversation-selection-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type {
  ClientConversation,
  ClientCardSendInput,
  ClientConversationMember,
  ContactGroup,
  ResolvedClientUser,
} from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import { listClientContacts, resolveClientUsers } from "@/lib/client-api/account"
import { listClientConversations } from "@/lib/client-api/conversations"
import { sendConversationCardMessage } from "@/lib/client-api/messages"
import { createClientMessageId } from "@/lib/message-id"
import { cn } from "@/lib/utils"

type SendCard = (conversationId: string, card: ClientCardSendInput) => Promise<unknown | null>
type SendCardDialogProps = {
  card: ClientCardSendInput
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function SendCardDialog(props: SendCardDialogProps) {
  return props.open ? <ConnectedSendCardDialog {...props} /> : null
}

function ConnectedSendCardDialog(props: SendCardDialogProps) {
  const { conversations, sendConversationCard } = useClientData()
  return (
    <SendCardDialogContent
      {...props}
      conversations={conversations}
      sendConversationCard={sendConversationCard}
    />
  )
}

/** The document child window deliberately has no ClientDataProvider. */
export function StandaloneCardDialog(props: SendCardDialogProps) {
  return props.open ? <StandaloneCardDialogContent {...props} /> : null
}

function StandaloneCardDialogContent(props: SendCardDialogProps) {
  const { t } = useLocale()
  const [conversations, setConversations] = React.useState<ClientConversation[]>([])

  React.useEffect(() => {
    if (!props.open) return
    let active = true
    const controller = new AbortController()

    async function loadConversations() {
      try {
        const values = await listClientConversations()
        if (!active) return

        setConversations(values)
        void hydrateStandaloneGroupAvatars(values, controller.signal)
      } catch (error) {
        if (active) toast.error(error instanceof Error ? error.message : t("sendCard.loadFailed"))
      }
    }

    async function hydrateStandaloneGroupAvatars(
      values: readonly ClientConversation[],
      signal: AbortSignal,
    ) {
      try {
        const contacts = await listClientContacts(undefined, signal)
        if (!active || signal.aborted) return

        const conversationsWithAvatarMembers = withStandaloneGroupAvatarMembers(
          values,
          contacts.groups,
        )
        setConversations(conversationsWithAvatarMembers)

        const userIds = collectStandaloneGroupAvatarUserIds(conversationsWithAvatarMembers)
        if (userIds.length === 0) return

        const users = await resolveStandaloneGroupAvatarUsers(userIds, signal)
        if (active && !signal.aborted) {
          setConversations(withStandaloneGroupAvatarUsers(conversationsWithAvatarMembers, users))
        }
      } catch {
        // 头像补全为非阻塞增强，保留已加载的会话并回退至群组图标。
      }
    }

    void loadConversations()
    return () => {
      active = false
      controller.abort()
    }
  }, [props.open, t])

  const sendConversationCard = React.useCallback<SendCard>(
    async (conversationId, card) => {
      if (card.type !== "card") return null
      try {
        return await sendConversationCardMessage(conversationId, {
          clientMessageId: createClientMessageId(),
          description: card.description,
          title: card.title,
          url: card.url,
        })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("sendCard.failed"))
        return null
      }
    },
    [t],
  )

  return (
    <SendCardDialogContent
      {...props}
      conversations={conversations}
      sendConversationCard={sendConversationCard}
    />
  )
}

function withStandaloneGroupAvatarMembers(
  conversations: readonly ClientConversation[],
  groups: readonly ContactGroup[],
): ClientConversation[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]))

  return conversations.map((conversation) => {
    if (conversation.type !== "group") return conversation

    const group = groupsById.get(conversation.id)
    if (!group) return conversation

    return {
      ...conversation,
      avatar: conversation.avatar || group.avatar,
      members:
        group.avatarMembers.length > 0
          ? mergeStandaloneGroupAvatarMembers(conversation.members, group.avatarMembers)
          : conversation.members,
    }
  })
}

function mergeStandaloneGroupAvatarMembers(
  conversationMembers: ClientConversationMember[] | undefined,
  avatarMembers: ContactGroup["avatarMembers"],
): ClientConversationMember[] {
  const conversationMembersByIdentity = new Map(
    conversationMembers?.map((member) => [getMemberIdentity(member), member]),
  )

  return avatarMembers.map((member) => {
    const conversationMember = conversationMembersByIdentity.get(getMemberIdentity(member))
    return {
      ...conversationMember,
      ...member,
      avatar: member.avatar || conversationMember?.avatar || "",
      email: conversationMember?.email ?? "",
      name: member.name || conversationMember?.name || "",
      nickname: member.nickname || conversationMember?.nickname || "",
      phone: conversationMember?.phone ?? "",
    }
  })
}

function collectStandaloneGroupAvatarUserIds(conversations: readonly ClientConversation[]) {
  const userIds = new Set<string>()
  for (const conversation of conversations) {
    if (conversation.type !== "group") continue
    for (const member of getStandaloneGroupAvatarMembers(conversation)) {
      if (member.type === "user" && !member.avatar && member.id.trim()) userIds.add(member.id)
    }
  }
  return [...userIds]
}

async function resolveStandaloneGroupAvatarUsers(userIds: readonly string[], signal: AbortSignal) {
  const users: ResolvedClientUser[] = []
  for (let start = 0; start < userIds.length; start += 100) {
    users.push(...(await resolveClientUsers(userIds.slice(start, start + 100), undefined, signal)))
  }
  return users
}

function withStandaloneGroupAvatarUsers(
  conversations: readonly ClientConversation[],
  users: readonly ResolvedClientUser[],
): ClientConversation[] {
  const usersById = new Map(users.map((user) => [user.id, user]))

  return conversations.map((conversation) => {
    if (conversation.type !== "group" || !conversation.members) return conversation

    let changed = false
    const members = conversation.members.map((member) => {
      if (member.type !== "user") return member
      const user = usersById.get(member.id)
      if (!user) return member

      const nextMember = {
        ...member,
        avatar: user.avatar,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        phone: user.phone,
      }
      if (
        nextMember.avatar === member.avatar &&
        nextMember.email === member.email &&
        nextMember.name === member.name &&
        nextMember.nickname === member.nickname &&
        nextMember.phone === member.phone
      ) {
        return member
      }

      changed = true
      return nextMember
    })

    return changed ? { ...conversation, members } : conversation
  })
}

function getStandaloneGroupAvatarMembers(conversation: ClientConversation) {
  return [...(conversation.members ?? [])]
    .sort((left, right) => getMemberRoleOrder(left.role) - getMemberRoleOrder(right.role))
    .slice(0, 4)
}

function getMemberIdentity(member: Pick<ClientConversationMember, "id" | "type">) {
  return `${member.type}:${member.id}`
}

function getMemberRoleOrder(role: ClientConversationMember["role"]) {
  if (role === "owner") return 0
  if (role === "admin") return 1
  return 2
}

function SendCardDialogContent({
  card,
  conversations,
  onOpenChange,
  open,
  sendConversationCard,
}: SendCardDialogProps & {
  conversations: ClientConversation[]
  sendConversationCard: SendCard
}) {
  const { t } = useLocale()
  const [keyword, setKeyword] = React.useState("")
  const [selectedConversationId, setSelectedConversationId] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const visibleConversations = React.useMemo(() => {
    const sendableConversations = conversations.filter(
      (conversation) => !conversation.topic?.archived,
    )
    const normalizedKeyword = keyword.trim().toLocaleLowerCase()
    if (!normalizedKeyword) {
      return sendableConversations
    }

    return sendableConversations.filter((conversation) =>
      conversation.name.toLocaleLowerCase().includes(normalizedKeyword),
    )
  }, [conversations, keyword])

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && submitting) {
      return
    }
    if (!nextOpen) {
      setKeyword("")
      setSelectedConversationId("")
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedConversationId || submitting) {
      return
    }

    setSubmitting(true)
    try {
      const message = await sendConversationCard(selectedConversationId, card)
      if (!message) {
        return
      }
      const conversation = conversations.find(
        (candidate) => candidate.id === selectedConversationId,
      )
      toast.success(
        conversation ? t("sendCard.sentTo", { name: conversation.name }) : t("sendCard.sent"),
      )
      setKeyword("")
      setSelectedConversationId("")
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="gap-5 sm:max-w-lg"
        showCloseButton={!submitting}
      >
        <DialogHeader>
          <DialogTitle className="text-base">{t("sendCard.title")}</DialogTitle>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t("sendCard.search")}
              className="pl-8"
              disabled={submitting}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("sendCard.search")}
              type="search"
              value={keyword}
            />
          </div>

          <div className="h-80 overflow-y-auto rounded-md border">
            <RadioGroup
              aria-label={t("sendCard.target")}
              className="grid-cols-[minmax(0,1fr)] gap-1 p-2"
              disabled={submitting}
              onValueChange={setSelectedConversationId}
              value={selectedConversationId}
            >
              {visibleConversations.map((conversation) => {
                const selected = conversation.id === selectedConversationId
                const radioId = `card-target-${conversation.id}`

                return (
                  <Item
                    asChild
                    className={cn(
                      "min-w-0 cursor-pointer px-2 py-1.5 hover:bg-muted",
                      selected && "bg-primary/10",
                    )}
                    key={conversation.id}
                    size="sm"
                  >
                    <Label htmlFor={radioId}>
                      <ItemMedia>
                        <ConversationSelectionAvatar conversation={conversation} />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full min-w-0">
                          <span className="min-w-0 truncate">{conversation.name}</span>
                          <Badge className="shrink-0" variant="secondary">
                            {conversationTypeLabel(conversation.type, t)}
                          </Badge>
                        </ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        <RadioGroupItem
                          aria-label={conversation.name}
                          id={radioId}
                          value={conversation.id}
                        />
                      </ItemActions>
                    </Label>
                  </Item>
                )
              })}
              {visibleConversations.length === 0 && (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {t("sendCard.noMatch")}
                </div>
              )}
            </RadioGroup>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={submitting} type="button" variant="outline">
                {t("sendCard.cancel")}
              </Button>
            </DialogClose>
            <Button disabled={!selectedConversationId || submitting} type="submit">
              {submitting && <Loader2Icon aria-hidden="true" className="animate-spin" />}
              {t("sendCard.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function conversationTypeLabel(
  type: ClientConversation["type"],
  t: ReturnType<typeof useLocale>["t"],
) {
  switch (type) {
    case "group":
      return t("sendCard.group")
    case "app":
      return "Agent"
    default:
      return t("sendCard.direct")
  }
}
