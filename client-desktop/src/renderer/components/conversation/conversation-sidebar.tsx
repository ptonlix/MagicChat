import * as React from "react"
import { BellOff, Bot, Pin, Plus } from "lucide-react"
import { toast } from "sonner"

import { ConversationListItemMenu } from "@/components/conversation-list-item-menu"
import { ConversationAvatar } from "@/components/conversation/conversation-avatar"
import { GlobalSearchCommand } from "@/components/global-search-command"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VirtualList } from "@/components/ui/virtual-list"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenuButton } from "@/components/ui/sidebar"
import { formatActivityTime } from "@/lib/activity-time"
import { getAvatarInitial } from "@/lib/avatar"
import type {
  ClientConversation,
  ClientUser,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import { getConversationDisplayName } from "@/lib/conversation-avatar-presentation"
import {
  getClientDataErrorMessage,
  isBuiltinAssistantConversation,
  isConversationTopicVisibleInList,
  orderConversations,
} from "@/lib/client-data-state"
import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import type { ConversationDrafts } from "@/lib/conversation-drafts"
import type { DirectorySearchItem } from "@/lib/local-search"
import { formatMentionTemplateText, type MentionLabelResolver } from "@/lib/message-mentions"
import { cn } from "@/lib/utils"

const conversationFilterOptions = [
  { label: "全部", value: "all" },
  { label: "未读", value: "unread" },
  { label: "单聊", value: "direct" },
  { label: "群聊", value: "group" },
] as const
type ConversationFilter = (typeof conversationFilterOptions)[number]["value"]
type ConversationListRow = { conversation: ClientConversation; nested: boolean }

export function ConversationSidebar({
  activeConversationId,
  appsById,
  contactApps = [],
  contactGroups = [],
  contacts = [],
  contactsById,
  conversations,
  currentUser,
  drafts,
  onCreateGroup,
  onDismissConversation,
  onSelectDirectoryItem = () => undefined,
  onSelectConversation,
  onSetConversationMuted,
  onSetConversationPinned,
}: {
  activeConversationId: string
  appsById: ReadonlyMap<string, ContactApp>
  contactApps?: ContactApp[]
  contactGroups?: ContactGroup[]
  contacts?: ContactUser[]
  contactsById: ReadonlyMap<string, ContactUser>
  conversations: ClientConversation[]
  currentUser: ClientUser
  drafts: ConversationDrafts
  onCreateGroup: () => void
  onDismissConversation?: (conversationId: string) => Promise<void>
  onSelectDirectoryItem?: (item: DirectorySearchItem) => void
  onSelectConversation: (conversationId: string) => void
  onSetConversationMuted: (conversationId: string, muted: boolean) => Promise<void>
  onSetConversationPinned: (conversationId: string, pinned: boolean) => Promise<void>
}) {
  const [mutingConversationId, setMutingConversationId] = React.useState("")
  const [pinningConversationId, setPinningConversationId] = React.useState("")
  const [dismissingConversationId, setDismissingConversationId] = React.useState("")
  const [dismissCandidate, setDismissCandidate] = React.useState<ClientConversation | null>(null)
  const [conversationFilter, setConversationFilter] = React.useState<ConversationFilter>("all")
  const [listNow, setListNow] = React.useState(() => Date.now())
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const interval = window.setInterval(() => setListNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const visibleRows = React.useMemo(
    () => getConversationListRows(conversations, activeConversationId, conversationFilter, listNow),
    [activeConversationId, conversationFilter, conversations, listNow],
  )

  async function handlePinnedChange(conversation: ClientConversation, pinned: boolean) {
    if (pinningConversationId) {
      return
    }
    setPinningConversationId(conversation.id)
    try {
      await onSetConversationPinned(conversation.id, pinned)
      toast.success(pinned ? "会话已置顶" : "已取消置顶")
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, pinned ? "置顶会话失败" : "取消置顶失败"))
    } finally {
      setPinningConversationId("")
    }
  }

  async function handleMutedChange(conversation: ClientConversation, muted: boolean) {
    if (mutingConversationId) {
      return
    }
    setMutingConversationId(conversation.id)
    try {
      await onSetConversationMuted(conversation.id, muted)
      toast.success(muted ? "消息免打扰已开启" : "消息免打扰已关闭")
    } catch (error) {
      toast.error(
        getClientDataErrorMessage(error, muted ? "开启消息免打扰失败" : "取消消息免打扰失败"),
      )
    } finally {
      setMutingConversationId("")
    }
  }

  async function handleDismissConversation() {
    if (!dismissCandidate || dismissingConversationId || !onDismissConversation) {
      return
    }
    const conversation = dismissCandidate
    setDismissingConversationId(conversation.id)
    try {
      await onDismissConversation(conversation.id)
      setDismissCandidate(null)
      toast.success("对话已删除")
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "删除对话失败"))
    } finally {
      setDismissingConversationId("")
    }
  }

  function handleConversationListContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target

    if (target instanceof Element && target.closest("[data-conversation-list-item-trigger]")) {
      return
    }

    event.preventDefault()
  }

  function renderConversationItem({ conversation, nested }: ConversationListRow) {
    const selected = conversation.id === activeConversationId
    const lastMessageTime = formatActivityTime(conversation.lastMessageAt ?? conversation.createdAt)
    const mentionLabelResolver = createConversationMentionLabelResolver({
      appsById,
      contactsById,
      conversation,
      currentUser,
    })
    const hasUnreadMention = conversation.lastMentionedSeq > conversation.lastReadSeq
    const preview = getConversationListPreview({
      draftText: conversation.topic?.archived ? undefined : drafts[conversation.id]?.text,
      hasUnreadMention,
      hasUnreadChoice: conversation.lastChoiceSeq > conversation.lastReadSeq,
      lastChoiceSeq: conversation.lastChoiceSeq,
      lastMentionedSeq: conversation.lastMentionedSeq,
      messageDescription: getConversationListDescription(
        conversation,
        currentUser.id,
        mentionLabelResolver,
      ),
      selected,
    })

    return (
      <ConversationListItemMenu
        dismissing={dismissingConversationId === conversation.id}
        key={conversation.id}
        muted={Boolean(conversation.notificationMuted)}
        muting={mutingConversationId === conversation.id}
        onDismiss={() => setDismissCandidate(conversation)}
        onMutedChange={(muted) => void handleMutedChange(conversation, muted)}
        onPinnedChange={(pinned) => void handlePinnedChange(conversation, pinned)}
        pinned={!nested && Boolean(conversation.pinned)}
        pinning={pinningConversationId === conversation.id}
        showPinAction={!nested && !isBuiltinAssistantConversation(conversation)}
      >
        <div className="group/menu-item relative" data-conversation-list-item-trigger>
          <SidebarMenuButton
            aria-selected={selected}
            className={cn(
              "desktop-conversation-list-item h-[68px] gap-3 rounded-none px-4 py-2.5 data-active:bg-teal-100 data-active:hover:bg-teal-100 dark:data-active:bg-teal-900 dark:data-active:hover:bg-teal-900",
              nested && "h-14 w-full py-1.5 pl-8",
              !nested &&
                conversation.pinned &&
                "bg-neutral-100 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-900",
            )}
            isActive={selected}
            onClick={() => onSelectConversation(conversation.id)}
            role="option"
            size="lg"
            type="button"
          >
            <ConversationListAvatar conversation={conversation} />
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden text-sm leading-snug font-medium underline-offset-4">
                <span className="flex min-w-0 flex-1 items-center overflow-hidden">
                  <span className="block min-w-0 flex-1 truncate">
                    {nested ? conversation.name : getConversationDisplayName(conversation)}
                  </span>
                  {conversation.topic?.archived && (
                    <span className="ml-1.5 shrink-0 text-[10px] font-normal text-muted-foreground">
                      已关闭
                    </span>
                  )}
                </span>
                {lastMessageTime && (
                  <span className="shrink-0 pr-2 text-xs font-normal text-muted-foreground">
                    {lastMessageTime}
                  </span>
                )}
              </div>
              <p className="flex w-full min-w-0 items-center gap-0.5 text-left text-xs leading-normal font-normal text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {preview.alertLabel && (
                    <span className="mr-1 font-medium text-rose-700 dark:text-rose-300">
                      {preview.alertLabel}
                    </span>
                  )}
                  <span>{preview.description}</span>
                </span>
                {((!nested && conversation.pinned) || conversation.notificationMuted) && (
                  <span className="mr-2 flex shrink-0 items-center gap-0.5">
                    {!nested && conversation.pinned && (
                      <Pin aria-label="已置顶" className="size-3! shrink-0" />
                    )}
                    {conversation.notificationMuted && (
                      <BellOff aria-label="消息免打扰已开启" className="size-3! shrink-0" />
                    )}
                  </span>
                )}
              </p>
            </div>
          </SidebarMenuButton>
        </div>
      </ConversationListItemMenu>
    )
  }

  return (
    <Sidebar className="desktop-conversation-sidebar border-r-0 bg-background" collapsible="none">
      <SidebarHeader className="gap-0 p-0">
        <div className="flex h-14 items-center justify-between px-4">
          <h1 className="text-base font-medium">消息</h1>
          <div className="flex items-center gap-1">
            <GlobalSearchCommand
              contactApps={contactApps}
              contactGroups={contactGroups}
              contacts={contacts}
              conversations={conversations}
              currentUserId={currentUser.id}
              onSelectConversation={onSelectConversation}
              onSelectDirectoryItem={onSelectDirectoryItem}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="新建 Agent"
                  size="icon-sm"
                  title="新建 Agent"
                  type="button"
                  variant="ghost"
                >
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem onSelect={onCreateGroup}>发起群聊</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="px-4 pb-3">
          <Tabs
            className="gap-0"
            onValueChange={(value) => setConversationFilter(value as ConversationFilter)}
            value={conversationFilter}
          >
            <TabsList aria-label="会话类型" className="grid w-full grid-cols-4">
              {conversationFilterOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </SidebarHeader>
      <SidebarContent ref={scrollRef} onContextMenu={handleConversationListContextMenu}>
        {visibleRows.length === 0 ? (
          <div className="px-2 pb-3" role="listbox">
            <div className="group/menu-item relative">
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {getEmptyConversationFilterMessage(conversationFilter)}
              </div>
            </div>
          </div>
        ) : (
          <VirtualList
            className="desktop-conversation-list flex flex-col gap-0 px-0 pb-2"
            estimateSize={68}
            getKey={(row) => row.conversation.id}
            items={visibleRows}
            renderItem={renderConversationItem}
            role="listbox"
            scrollRef={scrollRef}
          />
        )}
      </SidebarContent>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !dismissingConversationId) {
            setDismissCandidate(null)
          }
        }}
        open={Boolean(dismissCandidate)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，该对话将暂时从列表中移除。收到新消息后会重新显示，聊天记录不会删除，也不会退出群聊。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(dismissingConversationId)}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(dismissingConversationId)}
              onClick={(event) => {
                event.preventDefault()
                void handleDismissConversation()
              }}
              variant="destructive"
            >
              {dismissingConversationId ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  )
}

function getConversationListDescription(
  conversation: ClientConversation,
  currentUserId: string,
  mentionLabelResolver: MentionLabelResolver,
) {
  const summary = conversation.lastMessageSummary.trim()

  if (!summary) {
    return "暂无消息"
  }

  const description = formatMentionTemplateText(summary, mentionLabelResolver)
  const showsSender =
    conversation.type === "group" ||
    (conversation.type === "topic" && conversation.topic?.parentConversationType === "group")
  if (!showsSender) {
    return description
  }

  const senderName = getLastMessageSenderName(conversation, currentUserId)
  return senderName ? `${senderName}：${description}` : description
}

function getLastMessageSenderName(conversation: ClientConversation, currentUserId: string) {
  const sender = conversation.lastMessageSender
  if (!sender) {
    return ""
  }
  if (sender.type === "system") {
    return "系统"
  }
  if (sender.type === "user" && sender.id === currentUserId) {
    return "我"
  }

  return sender.nickname.trim() || sender.name.trim()
}

function getConversationListPreview({
  draftText,
  hasUnreadMention,
  hasUnreadChoice,
  lastChoiceSeq,
  lastMentionedSeq,
  messageDescription,
  selected,
}: {
  draftText: string | undefined
  hasUnreadMention: boolean
  hasUnreadChoice: boolean
  lastChoiceSeq: number
  lastMentionedSeq: number
  messageDescription: string
  selected: boolean
}) {
  if (selected) {
    return {
      alertLabel: null,
      description: messageDescription,
    }
  }

  if (hasUnreadChoice && lastChoiceSeq >= lastMentionedSeq) {
    return {
      alertLabel: "[选择]",
      description: messageDescription.replace(/(^|：)\[选择\]\s*/, "$1"),
    }
  }

  if (hasUnreadMention) {
    return {
      alertLabel: "[有人 @ 我]",
      description: messageDescription,
    }
  }

  if (draftText !== undefined) {
    return {
      alertLabel: "[草稿]",
      description: draftText,
    }
  }

  return {
    alertLabel: null,
    description: messageDescription,
  }
}

function getConversationListRows(
  conversations: ClientConversation[],
  activeConversationId: string,
  filter: ConversationFilter,
  now: number,
): ConversationListRow[] {
  const ordered = orderConversations(conversations, now)
  const parents = new Set(
    ordered.filter((conversation) => conversation.type !== "topic").map(({ id }) => id),
  )
  const topicsByParent = new Map<string, ClientConversation[]>()
  for (const conversation of ordered) {
    if (
      conversation.type !== "topic" ||
      !isConversationTopicVisibleInList(conversation, { activeConversationId, now })
    ) {
      continue
    }
    const parentId = conversation.topic?.parentConversationId
    if (!parentId || !parents.has(parentId)) continue
    const topics = topicsByParent.get(parentId) ?? []
    topics.push(conversation)
    topicsByParent.set(parentId, topics)
  }

  const rows: ConversationListRow[] = []
  for (const conversation of ordered) {
    if (conversation.type === "topic") continue
    const topics = topicsByParent.get(conversation.id) ?? []
    if (filter === "unread") {
      const unreadTopics = topics.filter(hasUnreadMessages)
      if (!hasUnreadMessages(conversation) && unreadTopics.length === 0) continue
      rows.push({ conversation, nested: false })
      rows.push(...unreadTopics.map((topic) => ({ conversation: topic, nested: true })))
      continue
    }
    const matches =
      filter === "all" ||
      conversation.type === filter ||
      (filter === "direct" && conversation.type === "app")
    if (!matches) continue
    rows.push({ conversation, nested: false })
    rows.push(...topics.map((topic) => ({ conversation: topic, nested: true })))
  }
  return rows
}

function hasUnreadMessages(conversation: ClientConversation) {
  return (
    conversation.unreadCount > 0 ||
    conversation.lastMessageSeq > conversation.lastReadSeq ||
    conversation.lastChoiceSeq > conversation.lastReadSeq
  )
}

function getEmptyConversationFilterMessage(filter: ConversationFilter) {
  if (filter === "all") return "暂无会话"
  const label = conversationFilterOptions.find((option) => option.value === filter)?.label ?? "会话"
  return `暂无${label}`
}

function ConversationListAvatar({ conversation }: { conversation: ClientConversation }) {
  const sourceSender = conversation.topic?.sourceSender
  return (
    <div className="relative shrink-0">
      {conversation.type === "topic" && sourceSender ? (
        <Avatar className="size-8 rounded-full bg-muted after:rounded-full">
          {sourceSender.avatar && (
            <AvatarImage
              alt={sourceSender.name}
              className="rounded-full"
              src={sourceSender.avatar}
            />
          )}
          <AvatarFallback aria-label={sourceSender.name} className="rounded-full">
            {sourceSender.type === "app" ? (
              <Bot className="size-4" />
            ) : (
              getAvatarInitial(sourceSender.name)
            )}
          </AvatarFallback>
        </Avatar>
      ) : (
        <ConversationAvatar className="size-10" conversation={conversation} />
      )}
      {conversation.unreadCount > 0 && (
        <span className="absolute top-0 right-0 z-10 translate-x-1/3 -translate-y-1/3">
          {conversation.notificationMuted ? (
            <span aria-label="有未读消息" className="block size-2 rounded-full bg-rose-700" />
          ) : (
            <ConversationUnreadBadge count={conversation.unreadCount} />
          )}
        </span>
      )}
    </div>
  )
}

function ConversationUnreadBadge({ count }: { count: number }) {
  return (
    <Badge
      aria-label={`${count} 条未读消息`}
      className="h-4 bg-rose-700 px-1 py-0 text-[10px] leading-4 font-normal text-white dark:bg-rose-700"
      variant="destructive"
    >
      {formatUnreadCount(count)}
    </Badge>
  )
}

function formatUnreadCount(count: number) {
  if (count > 99) {
    return "99+"
  }

  return String(count)
}
