import * as React from "react"
import { useSearchParams } from "react-router"
import { Plus, Search } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"
import {
  ClientDataRequestError,
  listConversationMessages,
  normalizeMessageCreatedEventPayload,
  sendConversationTextMessage,
  type ClientConversation,
  type ClientMessage,
  type ClientMessagePage,
  type ClientUser,
  type ContactUser,
} from "@/lib/client-data-api"
import { formatConversationLastMessageTime } from "@/lib/conversation-format"
import { createClientMessageId } from "@/lib/message-id"
import {
  ConversationPanel,
  type ConversationPanelMessage,
} from "@/components/conversation-panel"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"

type ConversationMessageState = {
  error: string | null
  loaded: boolean
  loadingBefore: boolean
  messages: ClientMessage[]
  page: ClientMessagePage | null
  sending: boolean
}

const messagePageLimit = 20
const emptyClientMessages: ClientMessage[] = []

function getMessageTime(createdAt: string) {
  const date = new Date(createdAt)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

export function ChatPage() {
  const {
    contacts,
    conversations,
    me,
    refreshConversations,
    updateConversationLastMessage,
  } = useClientData()
  const { ready: realtimeReady, subscribeRealtimeEvent } = useRealtime()
  const [searchParams, setSearchParams] = useSearchParams()
  const [messageStates, setMessageStates] = React.useState<
    Record<string, ConversationMessageState>
  >({})
  const loadingConversationIdsRef = React.useRef<Set<string>>(new Set())
  const previousRealtimeReadyRef = React.useRef(realtimeReady)
  const syncingAfterConversationIdsRef = React.useRef<Set<string>>(new Set())
  const [draft, setDraft] = React.useState("")
  const requestedConversationId = searchParams.get("conversation_id") ?? ""

  const activeConversation = React.useMemo(
    () =>
      requestedConversationId
        ? (conversations.find(
            (conversation) => conversation.id === requestedConversationId
          ) ?? null)
        : null,
    [conversations, requestedConversationId]
  )

  const activeConversationId = activeConversation?.id ?? ""
  const activeMessageState = activeConversationId
    ? messageStates[activeConversationId]
    : undefined
  const activeLoaded = Boolean(activeMessageState?.loaded)
  const activeClientMessages =
    activeMessageState?.messages ?? emptyClientMessages
  const contactsById = React.useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts]
  )
  const activeMessages = React.useMemo(
    () =>
      activeConversation
        ? activeClientMessages.map((message) =>
            toConversationPanelMessage(
              message,
              activeConversation,
              me,
              contactsById
            )
          )
        : [],
    [activeClientMessages, activeConversation, contactsById, me]
  )

  const updateConversationMessageState = React.useCallback(
    (
      conversationId: string,
      updater: (
        state: ConversationMessageState
      ) => ConversationMessageState
    ) => {
      setMessageStates((currentStates) => {
        const previousState =
          currentStates[conversationId] ?? createConversationMessageState()

        return {
          ...currentStates,
          [conversationId]: updater(previousState),
        }
      })
    },
    []
  )

  const rememberConversationMessage = React.useCallback(
    (message: ClientMessage) => {
      updateConversationLastMessage(message)
      if (
        !conversations.some(
          (conversation) => conversation.id === message.conversationId
        )
      ) {
        void refreshConversations().catch(() => undefined)
      }
    },
    [conversations, refreshConversations, updateConversationLastMessage]
  )

  const mergeIncomingMessage = React.useCallback(
    (message: ClientMessage, options: { markLoaded?: boolean } = {}) => {
      updateConversationMessageState(message.conversationId, (state) => {
        const messages = mergeConversationMessages(state.messages, [message])

        return {
          ...state,
          error: null,
          loaded: options.markLoaded ? true : state.loaded,
          messages,
          page: updatePageWithMessage(state.page, messages),
        }
      })
      rememberConversationMessage(message)
    },
    [rememberConversationMessage, updateConversationMessageState]
  )

  React.useEffect(() => {
    if (
      !activeConversationId ||
      activeLoaded ||
      loadingConversationIdsRef.current.has(activeConversationId)
    ) {
      return
    }

    loadingConversationIdsRef.current.add(activeConversationId)

    void listConversationMessages(activeConversationId, {
      limit: messagePageLimit,
    })
      .then((result) => {
        updateConversationMessageState(activeConversationId, (state) => ({
          ...state,
          error: null,
          loaded: true,
          messages: mergeConversationMessages(state.messages, result.messages),
          page: result.page,
        }))
      })
      .catch((error: unknown) => {
        const message = getClientDataErrorMessage(error, "加载消息失败")
        updateConversationMessageState(activeConversationId, (state) => ({
          ...state,
          error: message,
          loaded: true,
        }))
        toast.error(message)
      })
      .finally(() => {
        loadingConversationIdsRef.current.delete(activeConversationId)
      })
  }, [
    activeConversationId,
    activeLoaded,
    updateConversationMessageState,
  ])

  React.useEffect(() => {
    return subscribeRealtimeEvent("message.created", (payload) => {
      try {
        mergeIncomingMessage(normalizeMessageCreatedEventPayload(payload))
      } catch {
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [mergeIncomingMessage, subscribeRealtimeEvent])

  const loadBeforeMessages = React.useCallback(() => {
    if (!activeConversationId) {
      return
    }

    const state = messageStates[activeConversationId]
    if (
      !state?.page?.hasMoreBefore ||
      !state.loaded ||
      state.loadingBefore
    ) {
      return
    }

    const beforeSeq = state.page.oldestSeq
    updateConversationMessageState(activeConversationId, (currentState) => ({
      ...currentState,
      error: null,
      loadingBefore: true,
    }))

    void listConversationMessages(activeConversationId, {
      beforeSeq,
      limit: messagePageLimit,
    })
      .then((result) => {
        updateConversationMessageState(activeConversationId, (currentState) => ({
          ...currentState,
          error: null,
          loaded: true,
          loadingBefore: false,
          messages: mergeConversationMessages(
            currentState.messages,
            result.messages
          ),
          page: mergePageWithBeforeResult(
            currentState.page,
            result.page,
            mergeConversationMessages(currentState.messages, result.messages)
          ),
        }))
      })
      .catch((error: unknown) => {
        const message = getClientDataErrorMessage(error, "加载更早消息失败")
        updateConversationMessageState(activeConversationId, (currentState) => ({
          ...currentState,
          error: message,
          loadingBefore: false,
        }))
        toast.error(message)
      })
  }, [activeConversationId, messageStates, updateConversationMessageState])

  const syncAfterMessages = React.useCallback(
    (conversationId: string, afterSeq: number) => {
      if (syncingAfterConversationIdsRef.current.has(conversationId)) {
        return
      }

      syncingAfterConversationIdsRef.current.add(conversationId)

      void listConversationMessages(conversationId, {
        afterSeq,
        limit: messagePageLimit,
      })
        .then((result) => {
          const lastReceivedMessage =
            result.messages[result.messages.length - 1]
          updateConversationMessageState(conversationId, (currentState) => {
            const messages = mergeConversationMessages(
              currentState.messages,
              result.messages
            )

            return {
              ...currentState,
              error: null,
              messages,
              page: mergePageWithAfterResult(
                currentState.page,
                result.page,
                messages
              ),
            }
          })

          if (lastReceivedMessage) {
            rememberConversationMessage(lastReceivedMessage)
          }
        })
        .catch((error: unknown) => {
          toast.error(getClientDataErrorMessage(error, "同步新消息失败"))
        })
        .finally(() => {
          syncingAfterConversationIdsRef.current.delete(conversationId)
        })
    },
    [rememberConversationMessage, updateConversationMessageState]
  )

  React.useEffect(() => {
    const wasReady = previousRealtimeReadyRef.current
    previousRealtimeReadyRef.current = realtimeReady

    if (!realtimeReady || wasReady) {
      return
    }

    for (const [conversationId, state] of Object.entries(messageStates)) {
      if (!state.loaded) {
        continue
      }

      const newestSeq = getNewestMessageSeq(state)
      if (newestSeq > 0) {
        syncAfterMessages(conversationId, newestSeq)
      }
    }
  }, [messageStates, realtimeReady, syncAfterMessages])

  function sendMessage() {
    const content = draft.trim()
    if (!content || !activeConversationId || activeMessageState?.sending) {
      return
    }

    const clientMessageId = createClientMessageId()
    updateConversationMessageState(activeConversationId, (state) => ({
      ...state,
      sending: true,
    }))

    void sendConversationTextMessage(activeConversationId, {
      clientMessageId,
      content,
    })
      .then((message) => {
        mergeIncomingMessage(message, { markLoaded: true })
        setDraft("")
      })
      .catch((error: unknown) => {
        toast.error(getClientDataErrorMessage(error, "发送消息失败"))
      })
      .finally(() => {
        updateConversationMessageState(activeConversationId, (state) => ({
          ...state,
          sending: false,
        }))
      })
  }

  function selectConversation(conversationId: string) {
    setSearchParams({ conversation_id: conversationId }, { replace: true })
  }

  return (
    <>
      <aside className="flex w-80 shrink-0 flex-col border-r bg-background">
        <div className="flex h-14 items-center justify-between px-4">
          <h1 className="text-base font-medium">消息</h1>
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
              <DropdownMenuItem>发起群聊</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜索" type="search" />
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ItemGroup className="gap-1 px-2 pb-3 has-data-[size=sm]:gap-1">
            {conversations.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                暂无会话
              </div>
            )}
            {conversations.map((conversation) => {
              const selected = conversation.id === activeConversation?.id
              const lastMessageTime = formatConversationLastMessageTime(
                conversation.lastMessageAt
              )

              return (
                <Item
                  asChild
                  key={conversation.id}
                  size="sm"
                  className={cn(
                    "min-h-16 flex-nowrap px-2 py-2",
                    selected
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <Button
                    className="h-auto justify-start whitespace-normal"
                    type="button"
                    onClick={() => selectConversation(conversation.id)}
                    variant="ghost"
                  >
                    <ItemMedia>
                      <Avatar className="size-10 rounded-sm bg-muted after:rounded-sm">
                        {conversation.avatar && (
                          <AvatarImage
                            alt={conversation.name}
                            className="rounded-sm"
                            src={conversation.avatar}
                          />
                        )}
                        <AvatarFallback className="rounded-sm">
                          {getConversationInitial(conversation.name)}
                        </AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full min-w-0 justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{conversation.name}</span>
                          {conversation.type === "group" && (
                            <Badge variant="secondary" className="px-1.5">
                              群
                            </Badge>
                          )}
                        </span>
                        {lastMessageTime && (
                          <span className="shrink-0 pr-2 text-xs font-normal text-muted-foreground">
                            {lastMessageTime}
                          </span>
                        )}
                      </ItemTitle>
                      <ItemDescription className="truncate text-xs">
                        {getConversationListDescription(conversation)}
                      </ItemDescription>
                    </ItemContent>
                  </Button>
                </Item>
              )
            })}
          </ItemGroup>
        </ScrollArea>
      </aside>

      <ConversationPanel
        conversation={activeConversation}
        draft={draft}
        historyError={activeMessageState?.error ?? null}
        historyLoading={Boolean(activeConversation && !activeLoaded)}
        historyLoadingBefore={Boolean(activeMessageState?.loadingBefore)}
        messages={activeMessages}
        onDraftChange={setDraft}
        onLoadBeforeMessages={loadBeforeMessages}
        onSendMessage={sendMessage}
        sending={Boolean(activeMessageState?.sending)}
      />
    </>
  )
}

function getConversationListDescription(conversation: ClientConversation) {
  const summary = conversation.lastMessageSummary.trim()

  return summary || "暂无消息"
}

function getConversationInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}

function createConversationMessageState(): ConversationMessageState {
  return {
    error: null,
    loaded: false,
    loadingBefore: false,
    messages: [],
    page: null,
    sending: false,
  }
}

function mergeConversationMessages(
  currentMessages: ClientMessage[],
  nextMessages: ClientMessage[]
) {
  const messagesById = new Map<string, ClientMessage>()

  for (const message of currentMessages) {
    messagesById.set(message.id, message)
  }
  for (const message of nextMessages) {
    messagesById.set(message.id, message)
  }

  return Array.from(messagesById.values()).sort((messageA, messageB) => {
    if (messageA.seq !== messageB.seq) {
      return messageA.seq - messageB.seq
    }

    return messageA.createdAt.localeCompare(messageB.createdAt)
  })
}

function updatePageWithMessage(
  page: ClientMessagePage | null,
  messages: ClientMessage[]
): ClientMessagePage {
  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]

  return {
    hasMoreAfter: false,
    hasMoreBefore: page?.hasMoreBefore ?? false,
    limit: page?.limit ?? messagePageLimit,
    newestSeq: lastMessage?.seq ?? 0,
    oldestSeq: firstMessage?.seq ?? 0,
  }
}

function mergePageWithBeforeResult(
  currentPage: ClientMessagePage | null,
  resultPage: ClientMessagePage,
  messages: ClientMessage[]
): ClientMessagePage {
  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]

  return {
    hasMoreAfter: currentPage?.hasMoreAfter ?? resultPage.hasMoreAfter,
    hasMoreBefore: resultPage.hasMoreBefore,
    limit: resultPage.limit,
    newestSeq: lastMessage?.seq ?? currentPage?.newestSeq ?? 0,
    oldestSeq: firstMessage?.seq ?? resultPage.oldestSeq,
  }
}

function mergePageWithAfterResult(
  currentPage: ClientMessagePage | null,
  resultPage: ClientMessagePage,
  messages: ClientMessage[]
): ClientMessagePage {
  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]

  return {
    hasMoreAfter: resultPage.hasMoreAfter,
    hasMoreBefore: currentPage?.hasMoreBefore ?? resultPage.hasMoreBefore,
    limit: resultPage.limit,
    newestSeq: lastMessage?.seq ?? resultPage.newestSeq,
    oldestSeq: firstMessage?.seq ?? currentPage?.oldestSeq ?? 0,
  }
}

function getNewestMessageSeq(state: ConversationMessageState) {
  const lastMessage = state.messages[state.messages.length - 1]

  return Math.max(state.page?.newestSeq ?? 0, lastMessage?.seq ?? 0)
}

function toConversationPanelMessage(
  message: ClientMessage,
  conversation: ClientConversation,
  currentUser: Pick<ClientUser, "avatar" | "id">,
  contactsById: ReadonlyMap<string, ContactUser>
): ConversationPanelMessage {
  const fromMe =
    message.sender.type === "user" && message.sender.id === currentUser.id

  return {
    author: getMessageAuthor(message, conversation, currentUser.id),
    avatar: getMessageAvatar(message, conversation, currentUser, contactsById),
    content: message.body.content,
    id: message.id,
    role: fromMe ? "me" : "other",
    time: getMessageTime(message.createdAt),
  }
}

function getMessageAuthor(
  message: ClientMessage,
  conversation: ClientConversation,
  currentUserId: string
) {
  if (message.sender.type === "user" && message.sender.id === currentUserId) {
    return "我"
  }

  if (message.sender.type === "system") {
    return "系统"
  }

  if (message.sender.type === "app") {
    return conversation.name
  }

  if (conversation.type === "direct") {
    return conversation.name
  }

  return "成员"
}

function getMessageAvatar(
  message: ClientMessage,
  conversation: ClientConversation,
  currentUser: Pick<ClientUser, "avatar" | "id">,
  contactsById: ReadonlyMap<string, ContactUser>
) {
  if (message.sender.type === "user" && message.sender.id === currentUser.id) {
    return currentUser.avatar
  }

  if (message.sender.type === "user") {
    return (
      contactsById.get(message.sender.id)?.avatar ||
      (conversation.type === "direct" ? conversation.avatar : "")
    )
  }

  if (message.sender.type === "app") {
    return conversation.avatar
  }

  return ""
}

function getClientDataErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ClientDataRequestError) {
    return error.message
  }

  return fallbackMessage
}
