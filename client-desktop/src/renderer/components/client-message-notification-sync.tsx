import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { matchPath, useLocation, useNavigate } from "react-router"
import { toast } from "sonner"

import {
  getBrowserNotificationPermission,
  showBrowserMessageNotification,
} from "@/lib/browser-notifications"
import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import {
  formatClientMessageBodySummary,
  isClientMessageInitiatedByUser,
  type ClientConversation,
  type ClientMessage,
  type ClientMessageSender,
  type ClientUser,
  type ContactApp,
  type ContactUser,
  normalizeMessageCreatedEventNotificationMuted,
  normalizeMessageCreatedEventPayload,
} from "@/lib/client-data-api"
import { getConversationAppDisplayName } from "@/lib/conversation-app-profile"
import { useClientData } from "@/lib/client-data-context"
import { formatMentionTemplateText } from "@/lib/message-mentions"
import {
  playMessageNotificationSound,
  prepareMessageNotificationSound,
} from "@/lib/message-notification-sound"
import { useRealtime } from "@/lib/realtime-context"
import {
  isHostMessageNotificationSoundEnabled,
  showHostMessageNotification,
} from "@/lib/desktop-host"

const enableNotificationToastId = "enable-browser-message-notifications"

export function ClientMessageNotificationSync() {
  const { t } = useLocale()
  const latestTRef = React.useRef(t)
  React.useEffect(() => {
    latestTRef.current = t
  }, [t])
  const location = useLocation()
  const navigate = useNavigate()
  const { subscribeRealtimeEvent } = useRealtime()
  const {
    contactApps,
    contacts,
    conversations,
    foregroundConversationId,
    me,
    usersById = {},
  } = useClientData()
  const hydratedContacts = React.useMemo(
    () => [...contacts, ...Object.values(usersById)],
    [contacts, usersById],
  )
  const contactAppsById = React.useMemo(
    () => new Map(contactApps.map((app) => [app.id, app])),
    [contactApps],
  )
  const activeConversationId = React.useMemo(
    () => matchPath("/chat/:conversationId", location.pathname)?.params.conversationId ?? "",
    [location.pathname],
  )
  const visibleConversationId = foregroundConversationId || activeConversationId

  React.useEffect(() => {
    prepareMessageNotificationSound()
  }, [])

  React.useEffect(() => {
    return subscribeRealtimeEvent("message.created", (payload) => {
      try {
        const message = normalizeMessageCreatedEventPayload(payload)
        const conversation = conversations.find(
          (currentConversation) => currentConversation.id === message.conversationId,
        )
        if (
          isClientMessageInitiatedByUser(message, me.id) ||
          message.sender.type === "system" ||
          normalizeMessageCreatedEventNotificationMuted(payload) ||
          conversation?.notificationMuted
        ) {
          return
        }
        if (isHostMessageNotificationSoundEnabled()) {
          playMessageNotificationSound()
        }
        if (
          document.visibilityState === "visible" &&
          message.conversationId === visibleConversationId
        ) {
          return
        }

        const senderName = getMessageNotificationSenderName({
          appsById: contactAppsById,
          contacts: hydratedContacts,
          conversation,
          me,
          sender: message.sender,
          t: latestTRef.current,
        })
        const body = `${senderName}: ${getMessageNotificationSummary({
          appsById: contactAppsById,
          contacts: hydratedContacts,
          conversation,
          me,
          message,
          t: latestTRef.current,
        })}`

        if (
          showHostMessageNotification({
            conversationId: message.conversationId,
            messageId: message.id,
            preview: body,
            sender: senderName,
          })
        ) {
          return
        }

        if (getBrowserNotificationPermission() !== "granted") {
          toast.info(latestTRef.current("notification.enableHint"), {
            id: enableNotificationToastId,
          })
          return
        }

        const notified = showBrowserMessageNotification({
          body,
          tag: message.id,
          title: latestTRef.current("notification.title"),
          onClick: () => {
            window.focus()
            navigate(`/chat/${encodeURIComponent(message.conversationId)}`)
          },
        })
        if (!notified) {
          toast.info(latestTRef.current("notification.enableHint"), {
            id: enableNotificationToastId,
          })
        }
      } catch {
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [
    contactAppsById,
    hydratedContacts,
    conversations,
    me,
    navigate,
    subscribeRealtimeEvent,
    visibleConversationId,
  ])

  return null
}

function getMessageNotificationSenderName({
  contacts,
  conversation,
  appsById,
  me,
  sender,
  t,
}: {
  appsById: ReadonlyMap<string, ContactApp>
  contacts: ContactUser[]
  conversation: ClientConversation | undefined
  me: ClientUser
  sender: ClientMessageSender
  t: ReturnType<typeof useLocale>["t"]
}) {
  if (sender.type === "system") {
    return t("notification.system")
  }

  if (sender.type === "app") {
    return getConversationAppDisplayName(conversation, sender.id, appsById)
  }

  if (sender.id === me.id) {
    return formatUserName(me)
  }

  const contact = contacts.find((currentContact) => currentContact.id === sender.id)
  if (contact) {
    return formatUserName(contact)
  }

  const member = conversation?.members?.find((currentMember) => currentMember.id === sender.id)
  if (member) {
    return formatUserName(member)
  }

  if (conversation?.type === "direct") {
    return conversation.name
  }

  return t("notification.unknownUser")
}

function getMessageNotificationSummary({
  appsById,
  contacts,
  t,
  conversation,
  me,
  message,
}: {
  appsById: ReadonlyMap<string, ContactApp>
  contacts: ContactUser[]
  conversation: ClientConversation | undefined
  me: ClientUser
  message: ClientMessage
  t: ReturnType<typeof useLocale>["t"]
}) {
  const mentionLabelResolver = createConversationMentionLabelResolver({
    appsById,
    contactsById: new Map(contacts.map((contact) => [contact.id, contact])),
    conversation,
    currentUser: me,
  })
  const summary = formatMentionTemplateText(
    formatClientMessageBodySummary(message.body),
    mentionLabelResolver,
  )
    .trim()
    .replace(/\s+/g, " ")

  return summary || t("notification.newMessage")
}

function formatUserName(user: { name: string; nickname: string }) {
  const name = user.name.trim()
  const nickname = user.nickname.trim()

  return nickname || name
}
