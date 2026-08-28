import { useCallback, useRef, type RefObject } from "react"
import { useLocale } from "@/components/locale-provider"
import { toast } from "sonner"

import {
  sendConversationFileMessage,
  sendConversationImageMessage,
  sendConversationVoiceMessage,
  sendConversationLinkMessage,
  sendConversationMarkdownMessage,
  sendConversationCardMessage,
  sendConversationEntityCardMessage,
  sendConversationTextMessage,
} from "@/lib/client-data-api"
import type { ClientCardSendInput } from "@/lib/client-data-api"
import type { ClientMessage } from "@/lib/client-data-api"
import type {
  ClientConversationMessageState,
  ClientDataContextValue,
  SendConversationImageOptions,
  SendConversationMessageOptions,
} from "@/lib/client-data-context"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { createClientMessageId } from "@/lib/message-id"
import type { VoiceMessageRecording } from "@/lib/voice-message"

export function useConversationSenders({
  currentUserId,
  conversationMessageStatesRef,
  mergeIncomingConversationMessage,
  updateConversationMessageState,
}: {
  currentUserId: string
  conversationMessageStatesRef: RefObject<Record<string, ClientConversationMessageState>>
  mergeIncomingConversationMessage: ClientDataContextValue["mergeIncomingConversationMessage"]
  updateConversationMessageState: (
    conversationId: string,
    updater: (state: ClientConversationMessageState) => ClientConversationMessageState,
  ) => void
}) {
  const { t } = useLocale()
  const attemptsRef = useRef(new Set<string>())
  const sendOptimistic = useCallback(
    async function runOptimistic(
      conversationId: string,
      clientMessageId: string,
      body: ClientMessage["body"],
      replyToMessageId: string | undefined,
      request: () => Promise<ClientMessage>,
      failureText: string,
    ) {
      if (attemptsRef.current.has(clientMessageId)) return null

      const retry = () => {
        void runOptimistic(
          conversationId,
          clientMessageId,
          body,
          replyToMessageId,
          request,
          failureText,
        )
      }
      attemptsRef.current.add(clientMessageId)

      const state = conversationMessageStatesRef.current[conversationId]
      const temporary: ClientMessage = {
        body,
        clientMessageId,
        conversationId,
        createdAt: new Date().toISOString(),
        deliveryStatus: "sending",
        id: `optimistic:${clientMessageId}`,
        reactionVersion: 0,
        reactions: [],
        replyToMessageId,
        retry,
        sender: { id: currentUserId, type: "user" },
        seq:
          Math.max(
            state?.latestKnownSeq ?? 0,
            ...(state?.messages.map((item) => item.seq) ?? [0]),
          ) + 1,
      }
      mergeIncomingConversationMessage(temporary, { markLoaded: true })

      try {
        const message = await request()
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        mergeIncomingConversationMessage(
          { ...temporary, deliveryStatus: "failed" },
          { markLoaded: true },
        )
        toast.error(getClientDataErrorMessage(error, failureText))
        return null
      } finally {
        attemptsRef.current.delete(clientMessageId)
      }
    },
    [conversationMessageStatesRef, currentUserId, mergeIncomingConversationMessage],
  )

  const sendConversationText = useCallback(
    async (
      conversationId: string,
      content: string,
      options: SendConversationMessageOptions = {},
    ) => {
      const trimmedContent = content.trim()
      if (!conversationId || !trimmedContent) return null
      const clientMessageId = createClientMessageId()
      return sendOptimistic(
        conversationId,
        clientMessageId,
        { content: trimmedContent, type: "text" },
        options.replyToMessageId,
        () =>
          sendConversationTextMessage(conversationId, {
            clientMessageId,
            content: trimmedContent,
            replyToMessageId: options.replyToMessageId,
          }),
        t("data.sendMessageFailed"),
      )
    },
    [sendOptimistic, t],
  )

  const sendConversationMarkdown = useCallback(
    async (
      conversationId: string,
      content: string,
      options: SendConversationMessageOptions = {},
    ) => {
      const trimmedContent = content.trim()
      if (!conversationId || !trimmedContent) return null
      const clientMessageId = createClientMessageId()
      return sendOptimistic(
        conversationId,
        clientMessageId,
        { content: trimmedContent, type: "markdown" },
        options.replyToMessageId,
        () =>
          sendConversationMarkdownMessage(conversationId, {
            clientMessageId,
            content: trimmedContent,
            replyToMessageId: options.replyToMessageId,
          }),
        t("data.sendRichTextFailed"),
      )
    },
    [sendOptimistic, t],
  )

  const sendConversationLink = useCallback(
    async (conversationId: string, url: string, options: SendConversationMessageOptions = {}) => {
      const trimmedURL = url.trim()
      if (!conversationId || !trimmedURL) return null
      const clientMessageId = createClientMessageId()
      return sendOptimistic(
        conversationId,
        clientMessageId,
        { title: trimmedURL, type: "link", url: trimmedURL },
        options.replyToMessageId,
        () =>
          sendConversationLinkMessage(conversationId, {
            clientMessageId,
            replyToMessageId: options.replyToMessageId,
            url: trimmedURL,
          }),
        t("data.sendLinkFailed"),
      )
    },
    [sendOptimistic, t],
  )

  const sendConversationCard = useCallback(
    async (
      conversationId: string,
      card: ClientCardSendInput,
      options: SendConversationMessageOptions = {},
    ) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || !isValidCardSendInput(card) || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message =
          card.type === "entity_card"
            ? await sendConversationEntityCardMessage(conversationId, {
                clientMessageId,
                entityId: card.entityId.trim(),
                entityType: card.entityType,
                replyToMessageId: options.replyToMessageId,
              })
            : await sendConversationCardMessage(conversationId, {
                clientMessageId,
                description: card.description.trim(),
                replyToMessageId: options.replyToMessageId,
                title: card.title.trim(),
                url: card.url.trim(),
              })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, t("data.sendCardFailed")))
        return null
      } finally {
        updateConversationMessageState(conversationId, (currentState) => ({
          ...currentState,
          sending: false,
        }))
      }
    },
    [
      conversationMessageStatesRef,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
      t,
    ],
  )

  const sendConversationFile = useCallback(
    async (conversationId: string, file: File, options: SendConversationMessageOptions = {}) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationFileMessage(conversationId, {
          clientMessageId,
          file,
          replyToMessageId: options.replyToMessageId,
        })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, t("data.sendFileFailed")))
        return null
      } finally {
        updateConversationMessageState(conversationId, (currentState) => ({
          ...currentState,
          sending: false,
        }))
      }
    },
    [
      conversationMessageStatesRef,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
      t,
    ],
  )

  const sendConversationImage = useCallback(
    async (conversationId: string, image: File, options: SendConversationImageOptions = {}) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationImageMessage(conversationId, {
          caption: options.caption,
          captionType: options.captionType,
          clientMessageId,
          image,
          replyToMessageId: options.replyToMessageId,
        })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, t("data.sendImageFailed")))
        return null
      } finally {
        updateConversationMessageState(conversationId, (currentState) => ({
          ...currentState,
          sending: false,
        }))
      }
    },
    [
      conversationMessageStatesRef,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
      t,
    ],
  )

  const sendConversationVoice = useCallback(
    async (
      conversationId: string,
      voice: VoiceMessageRecording,
      options: SendConversationMessageOptions = {},
    ) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationVoiceMessage(conversationId, {
          clientMessageId,
          durationMS: voice.durationMS,
          replyToMessageId: options.replyToMessageId,
          transcript: voice.transcript,
          voice: voice.blob,
        })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, t("data.sendVoiceFailed")))
        return null
      } finally {
        updateConversationMessageState(conversationId, (currentState) => ({
          ...currentState,
          sending: false,
        }))
      }
    },
    [
      conversationMessageStatesRef,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
      t,
    ],
  )

  return {
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationCard,
    sendConversationText,
    sendConversationVoice,
  }
}

function isValidCardSendInput(card: ClientCardSendInput) {
  if (card.type === "entity_card") {
    return Boolean(card.entityId.trim())
  }
  return Boolean(card.title.trim() && card.description.trim() && card.url.trim())
}
