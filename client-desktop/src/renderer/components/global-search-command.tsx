import * as React from "react"
import { Bot, Search, SearchX } from "lucide-react"

import { ConversationAvatar } from "@/components/conversation/conversation-avatar"
import { GroupAvatar } from "@/components/group-avatar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getAvatarInitial } from "@/lib/avatar"
import type {
  ClientConversation,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import { getConversationDisplayName } from "@/lib/conversation-avatar-presentation"
import type { ConversationSearchField, ConversationSearchResult } from "@/lib/conversation-search"
import {
  createLocalSearchService,
  type DirectorySearchItem,
  type LocalSearchScope,
} from "@/lib/local-search"
import { cn } from "@/lib/utils"

const scopes = [
  { available: true, label: "综合", value: "all" },
  { available: true, label: "通讯录", value: "directory" },
  { available: true, label: "对话", value: "conversation" },
  { available: false, label: "聊天记录", value: "messages" },
  { available: false, label: "文档", value: "documents" },
  { available: false, label: "任务", value: "tasks" },
] as const
type Scope = (typeof scopes)[number]["value"]

type SearchOption =
  | { item: DirectorySearchItem; key: string; type: "directory" }
  | { result: ConversationSearchResult; key: string; type: "conversation" }

export function GlobalSearchCommand({
  contactApps,
  contactGroups,
  contacts,
  conversations,
  currentUserId,
  getConversationDescription = getDefaultConversationDescription,
  onSelectDirectoryItem,
  onSelectConversation,
}: {
  contactApps: ContactApp[]
  contactGroups: ContactGroup[]
  contacts: ContactUser[]
  conversations: ClientConversation[]
  currentUserId: string
  getConversationDescription?: (conversation: ClientConversation) => string
  onSelectDirectoryItem: (item: DirectorySearchItem) => void
  onSelectConversation: (conversationId: string) => void
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const [open, setOpen] = React.useState(false)
  const [keyword, setKeyword] = React.useState("")
  const [scope, setScope] = React.useState<Scope>("all")
  const [activeIndex, setActiveIndex] = React.useState(0)
  const service = React.useMemo(
    () =>
      createLocalSearchService({
        apps: contactApps,
        contacts,
        conversations,
        currentUserId,
        groups: contactGroups,
      }),
    [contactApps, contactGroups, contacts, conversations, currentUserId],
  )
  const scopeDefinition = scopes.find((candidate) => candidate.value === scope)!
  const results = React.useMemo(
    () => service.search({ keyword, scope: getLocalSearchScope(scope) }),
    [keyword, scope, service],
  )
  const options = React.useMemo<SearchOption[]>(
    () =>
      scopeDefinition.available
        ? [
            ...results.directory.map((item) => ({
              item,
              key: `directory:${item.type}:${item.id}`,
              type: "directory" as const,
            })),
            ...results.conversations.map((result) => ({
              result,
              key: `conversation:${result.conversation.id}`,
              type: "conversation" as const,
            })),
          ]
        : [],
    [results.conversations, results.directory, scopeDefinition.available],
  )
  const normalizedActiveIndex =
    options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1)
  const activeOption = normalizedActiveIndex >= 0 ? options[normalizedActiveIndex] : undefined

  React.useEffect(() => {
    if (!activeOption) return
    optionRefs.current.get(activeOption.key)?.scrollIntoView?.({ block: "nearest" })
  }, [activeOption])

  function close() {
    setOpen(false)
    setKeyword("")
    setActiveIndex(0)
  }

  function selectOption(option: SearchOption) {
    if (option.type === "directory") {
      onSelectDirectoryItem(option.item)
    } else {
      onSelectConversation(option.result.conversation.id)
    }
    close()
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (options.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((current) => (Math.min(current, options.length - 1) + 1) % options.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((current) => {
        const normalized = Math.min(current, options.length - 1)
        return (normalized - 1 + options.length) % options.length
      })
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(options.length - 1)
      return
    }
    if (event.key === "Enter" && activeOption) {
      event.preventDefault()
      selectOption(activeOption)
    }
  }

  function handleScopeChange(value: string) {
    setScope(value as Scope)
    setActiveIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const hasKeyword = keyword.trim().length > 0
  const activeDescendant = activeOption
    ? `global-search-option-${normalizedActiveIndex}`
    : undefined

  return (
    <>
      <Button
        aria-label="全局搜索"
        onClick={() => setOpen(true)}
        size="icon-sm"
        title="全局搜索"
        type="button"
        variant="ghost"
      >
        <Search className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">全局搜索</DialogTitle>
          <DialogDescription className="sr-only">搜索通讯录和会话</DialogDescription>
          <div className="flex h-11 items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              aria-activedescendant={activeDescendant}
              aria-autocomplete="list"
              aria-controls="global-search-results"
              aria-expanded={open}
              aria-label="搜索所有内容"
              autoComplete="off"
              autoFocus
              className="h-full w-full rounded-none border-0 bg-transparent px-0 text-sm shadow-none outline-none focus-visible:ring-0"
              onChange={(event) => {
                setKeyword(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="搜索"
              role="combobox"
              value={keyword}
            />
          </div>
          <Tabs className="gap-0" onValueChange={handleScopeChange} value={scope}>
            <div className="w-full overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList aria-label="搜索内容" className="justify-start" variant="line">
                {scopes.map((item) => (
                  <TabsTrigger key={item.value} value={item.value}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
          <div
            aria-label="搜索结果"
            className="max-h-96 min-h-48 overflow-y-auto p-2"
            id="global-search-results"
            role="listbox"
          >
            {!hasKeyword ? (
              <GlobalSearchEmptyState state="idle" />
            ) : !scopeDefinition.available ? (
              <div className="py-12 text-center text-sm text-muted-foreground">待完善</div>
            ) : options.length === 0 ? (
              <GlobalSearchEmptyState state="no-results" />
            ) : (
              <>
                {results.directory.length > 0 && (
                  <SearchGroupLabel id="global-search-directory-label">通讯录</SearchGroupLabel>
                )}
                {results.directory.map((item, index) => {
                  const option = options[index]
                  return (
                    <SearchRow
                      active={index === normalizedActiveIndex}
                      avatar={<DirectorySearchResultAvatar item={item} />}
                      description={getDirectoryDescription(item)}
                      id={`global-search-option-${index}`}
                      key={option.key}
                      label={getDirectoryName(item)}
                      onClick={() => selectOption(option)}
                      onPointerMove={() => setActiveIndex(index)}
                      optionRef={(node) => setOptionRef(optionRefs.current, option.key, node)}
                    />
                  )
                })}
                {results.conversations.length > 0 && (
                  <SearchGroupLabel id="global-search-conversation-label">对话</SearchGroupLabel>
                )}
                {results.conversations.map((result, resultIndex) => {
                  const index = results.directory.length + resultIndex
                  const option = options[index]
                  return (
                    <SearchRow
                      active={index === normalizedActiveIndex}
                      avatar={
                        <ConversationAvatar
                          className="size-8"
                          conversation={result.conversation}
                          sourceAvatarClassName="size-4"
                        />
                      }
                      description={getConversationResultDescription(
                        result,
                        keyword,
                        getConversationDescription,
                      )}
                      id={`global-search-option-${index}`}
                      key={option.key}
                      label={getConversationDisplayName(result.conversation)}
                      onClick={() => selectOption(option)}
                      onPointerMove={() => setActiveIndex(index)}
                      optionRef={(node) => setOptionRef(optionRefs.current, option.key, node)}
                    />
                  )
                })}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function getLocalSearchScope(scope: Scope): LocalSearchScope {
  if (scope === "directory" || scope === "conversation") return scope
  return "all"
}

function SearchGroupLabel({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <p className="px-2 py-1 text-xs text-muted-foreground" id={id}>
      {children}
    </p>
  )
}

function GlobalSearchEmptyState({ state }: { state: "idle" | "no-results" }) {
  const idle = state === "idle"
  return (
    <Empty className="min-h-48 rounded-none p-8">
      <EmptyMedia variant="icon">{idle ? <Search /> : <SearchX />}</EmptyMedia>
      <EmptyHeader>
        <EmptyDescription>{idle ? "输入关键词开始搜索" : "未找到相关内容"}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function SearchRow({
  active,
  avatar,
  description,
  id,
  label,
  onClick,
  onPointerMove,
  optionRef,
}: {
  active: boolean
  avatar: React.ReactNode
  description: string
  id: string
  label: string
  onClick: () => void
  onPointerMove: () => void
  optionRef: (node: HTMLButtonElement | null) => void
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left outline-none hover:bg-accent",
        active && "bg-accent text-accent-foreground",
      )}
      id={id}
      onClick={onClick}
      onPointerMove={onPointerMove}
      ref={optionRef}
      role="option"
      tabIndex={-1}
      type="button"
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function DirectorySearchResultAvatar({ item }: { item: DirectorySearchItem }) {
  if (item.type === "group") {
    return (
      <GroupAvatar
        avatar={item.avatar}
        className="size-8"
        members={item.avatarMembers}
        name={item.name}
      />
    )
  }

  const name = getDirectoryName(item)
  return (
    <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
      {item.avatar && <AvatarImage alt={name} className="rounded-sm" src={item.avatar} />}
      <AvatarFallback aria-label={name} className="rounded-sm">
        {item.type === "app" ? <Bot className="size-4" /> : getAvatarInitial(name)}
      </AvatarFallback>
    </Avatar>
  )
}

function getDirectoryName(item: DirectorySearchItem) {
  return item.type === "user" ? item.nickname.trim() || item.name.trim() : item.name.trim()
}

function getDirectoryDescription(item: DirectorySearchItem) {
  if (item.type === "user") return item.email.trim() || item.phone.trim() || "联系人"
  if (item.type === "app") return item.description.trim() || "应用"
  return `${item.memberCount} 位成员${item.joined ? " · 已加入" : ""}`
}

function getConversationResultDescription(
  result: ConversationSearchResult,
  keyword: string,
  getConversationDescription: (conversation: ClientConversation) => string,
) {
  if (!keyword.trim()) return getConversationDescription(result.conversation)
  const field = result.matchedField
  if (!field || field.kind === "conversation_name") return "匹配会话名称"
  const displayName = field.memberDisplayName
  const value = field.rawValue
  return displayName && displayName !== value
    ? `${getConversationMatchLabel(field)}：${displayName} · ${value}`
    : `${getConversationMatchLabel(field)}：${value}`
}

function getConversationMatchLabel(field: ConversationSearchField) {
  if (field.kind === "member_email") return "匹配邮箱"
  if (field.kind === "member_phone") return "匹配手机号"
  if (field.kind === "app_name") return "匹配应用成员"
  return "匹配成员"
}

function getDefaultConversationDescription(conversation: ClientConversation) {
  return conversation.lastMessageSummary.trim() || "暂无消息"
}

function setOptionRef(
  refs: Map<string, HTMLButtonElement>,
  key: string,
  node: HTMLButtonElement | null,
) {
  if (node) refs.set(key, node)
  else refs.delete(key)
}
