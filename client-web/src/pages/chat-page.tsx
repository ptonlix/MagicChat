import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import { useClientData } from "@/lib/client-data-context"
import { useConversationDrafts } from "@/hooks/use-conversation-drafts"
import {
  type ClientConversation,
  type ClientMessage,
  type ContactApp,
  type ContactUser,
} from "@/lib/client-data-api"
import {
  emptyConversationDraft,
  type ConversationDraftMention,
} from "@/lib/conversation-drafts"
import type { VoiceMessageRecording } from "@/lib/voice-message"
import {
  formatConversationMessageSummary,
  toConversationPanelMessage,
} from "@/lib/conversation-message-presenter"
import { CreateGroupConversationDialog } from "@/components/conversation/create-group-conversation-dialog"
import { ConversationSidebar } from "@/components/conversation/conversation-sidebar"
import {
  ConversationPanel,
  type ConversationPanelMessage,
} from "@/components/conversation-panel"
import { SidebarProvider } from "@/components/ui/sidebar"

const emptyClientMessages: ClientMessage[] = []

function normalizeSingleLinkMessageURL(content: string) {
  const value = content.trim()
  if (!value || /\s/.test(value)) {
    return null
  }

  const linkCandidate = value.toLowerCase().startsWith("www.")
    ? `https://${value}`
    : value

  try {
    const url = new URL(linkCandidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }
    if (!url.hostname) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

export function ChatPage() {
  const navigate = useNavigate()
  const { conversationId } = useParams<{ conversationId?: string }>()
  const {
    contactApps,
    contacts,
    conversations,
    createGroupConversation,
    ensureConversationMessages,
    getConversation,
    getConversationMessageState,
    loadBeforeConversationMessages,
    markConversationRead,
    me,
    revokeConversationMessage,
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationText,
    sendConversationVoice,
  } = useClientData()
  const {
    clearConversationDraft,
    drafts,
    flushDrafts,
    updateConversationDraft,
  } = useConversationDrafts(me.id)
  const [richTextMode, setRichTextMode] = React.useState(false)
  const [createGroupDialogOpen, setCreateGroupDialogOpen] =
    React.useState(false)
  const requestedConversationId = conversationId ?? ""

  const activeConversation = React.useMemo(
    () =>
      requestedConversationId ? getConversation(requestedConversationId) : null,
    [getConversation, requestedConversationId]
  )

  const activeConversationId = activeConversation?.id ?? ""
  const activeDraft = drafts[activeConversationId] ?? emptyConversationDraft
  const draft = activeDraft.text
  const replyTarget = activeDraft.replyTarget
  const activeMessageState = activeConversationId
    ? getConversationMessageState(activeConversationId)
    : undefined
  const activeConversationHasUnreadProgress = Boolean(
    activeConversation &&
    (activeConversation.unreadCount > 0 ||
      activeConversation.lastReadSeq < activeConversation.lastMessageSeq)
  )
  const historyLoading = Boolean(
    activeConversation &&
    activeMessageState &&
    !activeMessageState.loaded &&
    !activeMessageState.error
  )
  const activeClientMessages =
    activeMessageState?.messages ?? emptyClientMessages
  const activeClientMessagesById = React.useMemo(
    () => new Map(activeClientMessages.map((message) => [message.id, message])),
    [activeClientMessages]
  )
  const contactsById = React.useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts]
  )
  const contactAppsByLookup = React.useMemo(() => {
    const appsByLookup = new Map<string, ContactApp>()

    for (const app of contactApps) {
      appsByLookup.set(app.id, app)
      appsByLookup.set(app.name, app)
    }

    return appsByLookup
  }, [contactApps])
  const activeMentionLabelResolver = React.useMemo(
    () =>
      createConversationMentionLabelResolver({
        appsById: contactAppsByLookup,
        contactsById,
        conversation: activeConversation,
        currentUser: me,
      }),
    [activeConversation, contactAppsByLookup, contactsById, me]
  )
  const activeConversationOnline = activeConversation
    ? getConversationOnlineStatus(
        activeConversation,
        me.id,
        contactsById,
        contactAppsByLookup
      )
    : undefined
  const activeMessages = React.useMemo(
    () =>
      activeConversation
        ? activeClientMessages.map((message) =>
            toConversationPanelMessage(
              message,
              activeConversation,
              me,
              contactsById,
              contactAppsByLookup,
              activeClientMessagesById,
              activeMentionLabelResolver
            )
          )
        : [],
    [
      activeClientMessages,
      activeClientMessagesById,
      activeConversation,
      activeMentionLabelResolver,
      contactAppsByLookup,
      contactsById,
      me,
    ]
  )

  const setDraft = React.useCallback(
    (nextDraft: string, nextMentions: ConversationDraftMention[]) => {
      updateConversationDraft(activeConversationId, (currentDraft) => ({
        ...currentDraft,
        mentions: nextMentions,
        text: nextDraft,
      }))
    },
    [activeConversationId, updateConversationDraft]
  )

  React.useEffect(() => {
    if (!activeConversationId) {
      return
    }

    ensureConversationMessages(activeConversationId)
  }, [activeConversationId, ensureConversationMessages])

  React.useEffect(() => {
    if (!activeConversationId || !activeConversationHasUnreadProgress) {
      return
    }

    function markActiveConversationRead() {
      if (document.visibilityState !== "visible") {
        return
      }

      void markConversationRead(activeConversationId).catch(() => undefined)
    }

    markActiveConversationRead()
    const interval = window.setInterval(markActiveConversationRead, 20_000)

    function handleVisibilityChange() {
      markActiveConversationRead()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [
    activeConversationId,
    activeConversationHasUnreadProgress,
    markConversationRead,
  ])

  const loadBeforeMessages = React.useCallback(() => {
    if (!activeConversationId) {
      return
    }

    loadBeforeConversationMessages(activeConversationId)
  }, [activeConversationId, loadBeforeConversationMessages])

  const clearReplyTarget = React.useCallback(() => {
    updateConversationDraft(activeConversationId, (currentDraft) => ({
      ...currentDraft,
      replyTarget: null,
    }))
  }, [activeConversationId, updateConversationDraft])

  const replyToMessage = React.useCallback(
    (message: ConversationPanelMessage) => {
      updateConversationDraft(activeConversationId, (currentDraft) => ({
        ...currentDraft,
        replyTarget: {
          id: message.id,
          author: message.author,
          summary: formatConversationMessageSummary(
            message.body,
            activeMentionLabelResolver
          ),
        },
      }))
    },
    [activeConversationId, activeMentionLabelResolver, updateConversationDraft]
  )

  const revokeMessage = React.useCallback(
    (message: ConversationPanelMessage) => {
      if (!activeConversationId || !message.canRevoke) {
        return
      }

      void revokeConversationMessage(activeConversationId, message.id).catch(
        () => {
          toast.error("撤回消息失败")
        }
      )
    },
    [activeConversationId, revokeConversationMessage]
  )

  function clearSentReplyTarget(
    conversationId: string,
    replyToMessageId: string | undefined
  ) {
    if (!replyToMessageId) {
      return
    }

    updateConversationDraft(conversationId, (currentDraft) =>
      currentDraft.replyTarget?.id === replyToMessageId
        ? { ...currentDraft, replyTarget: null }
        : currentDraft
    )
    flushDrafts()
  }

  function sendMessage(contentOverride?: string) {
    const visibleContent = draft.trim()
    const content = (contentOverride ?? draft).trim()
    if (!content || !activeConversationId || activeMessageState?.sending) {
      return
    }

    const sendingConversationId = activeConversationId
    const sendingReplyToMessageId = replyTarget?.id
    const linkURL = normalizeSingleLinkMessageURL(visibleContent)
    const sendConversation = linkURL
      ? sendConversationLink
      : richTextMode
        ? sendConversationMarkdown
        : sendConversationText
    const sendContent = linkURL ?? content

    void sendConversation(sendingConversationId, sendContent, {
      replyToMessageId: sendingReplyToMessageId,
    }).then((message) => {
      if (message) {
        clearConversationDraft(sendingConversationId)
        flushDrafts()
      }
    })
  }

  async function sendFileMessage(file: File) {
    if (!activeConversationId || activeMessageState?.sending) {
      return null
    }

    const sendingConversationId = activeConversationId
    const sendingReplyToMessageId = replyTarget?.id
    const message = await sendConversationFile(sendingConversationId, file, {
      replyToMessageId: sendingReplyToMessageId,
    })
    if (message) {
      clearSentReplyTarget(sendingConversationId, sendingReplyToMessageId)
    }

    return message
  }

  async function sendImageMessage(image: File) {
    if (!activeConversationId || activeMessageState?.sending) {
      return null
    }

    const sendingConversationId = activeConversationId
    const sendingReplyToMessageId = replyTarget?.id
    const message = await sendConversationImage(sendingConversationId, image, {
      replyToMessageId: sendingReplyToMessageId,
    })
    if (message) {
      clearSentReplyTarget(sendingConversationId, sendingReplyToMessageId)
    }

    return message
  }

  async function sendVoiceMessage(voice: VoiceMessageRecording) {
    if (!activeConversationId || activeMessageState?.sending) {
      return null
    }

    const sendingConversationId = activeConversationId
    const sendingReplyToMessageId = replyTarget?.id
    const message = await sendConversationVoice(sendingConversationId, voice, {
      replyToMessageId: sendingReplyToMessageId,
    })
    if (message) {
      clearSentReplyTarget(sendingConversationId, sendingReplyToMessageId)
    }

    return message
  }

  function selectConversation(conversationId: string) {
    flushDrafts()
    navigate(`/chat/${encodeURIComponent(conversationId)}`, { replace: true })
  }

  async function startGroupConversation(
    name: string,
    memberIds: string[],
    appIds: string[]
  ) {
    const conversation = await createGroupConversation(name, memberIds, appIds)
    flushDrafts()
    navigate(`/chat/${encodeURIComponent(conversation.id)}`)
  }

  return (
    <SidebarProvider
      className="min-h-0 min-w-0 flex-1"
      style={
        {
          "--sidebar-width": "18rem",
        } as React.CSSProperties
      }
    >
      <ConversationSidebar
        activeConversationId={activeConversationId}
        appsById={contactAppsByLookup}
        contactsById={contactsById}
        conversations={conversations}
        currentUser={me}
        drafts={drafts}
        onCreateGroup={() => setCreateGroupDialogOpen(true)}
        onSelectConversation={selectConversation}
      />

      <ConversationPanel
        key={activeConversationId || "empty"}
        conversation={activeConversation}
        conversationOnline={activeConversationOnline}
        currentUserId={me.id}
        draft={draft}
        draftMentions={activeDraft.mentions}
        historyError={activeMessageState?.error ?? null}
        historyLoading={historyLoading}
        historyLoadingBefore={Boolean(activeMessageState?.loadingBefore)}
        mentionLabelResolver={activeMentionLabelResolver}
        messages={activeMessages}
        onCancelReply={clearReplyTarget}
        onDraftBlur={flushDrafts}
        onDraftChange={setDraft}
        onReplyToMessage={replyToMessage}
        onRevokeMessage={revokeMessage}
        onRichTextModeChange={setRichTextMode}
        onSendFile={sendFileMessage}
        onSendImage={sendImageMessage}
        onSendVoice={sendVoiceMessage}
        onLoadBeforeMessages={loadBeforeMessages}
        onSendMessage={sendMessage}
        replyTarget={replyTarget}
        richTextMode={richTextMode}
        sending={Boolean(activeMessageState?.sending)}
      />
      <CreateGroupConversationDialog
        apps={contactApps}
        contacts={contacts}
        currentUserId={me.id}
        open={createGroupDialogOpen}
        onCreate={startGroupConversation}
        onOpenChange={setCreateGroupDialogOpen}
      />
    </SidebarProvider>
  )
}

function getConversationOnlineStatus(
  conversation: ClientConversation,
  currentUserId: string,
  contactsById: ReadonlyMap<string, ContactUser>,
  contactAppsByLookup: ReadonlyMap<string, ContactApp>
) {
  if (conversation.type === "direct") {
    const otherMember = conversation.members?.find(
      (member) => member.id !== currentUserId
    )

    return otherMember
      ? (contactsById.get(otherMember.id)?.online ?? false)
      : false
  }

  if (conversation.type === "app") {
    return (
      contactAppsByLookup.get(conversation.id)?.online ??
      contactAppsByLookup.get(conversation.name)?.online
    )
  }

  return undefined
}
