import { useCallback, type RefObject } from "react"
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
  conversationMessageStatesRef,
  mergeIncomingConversationMessage,
  updateConversationMessageState,
}: {
  conversationMessageStatesRef: RefObject<Record<string, ClientConversationMessageState>>
  mergeIncomingConversationMessage: ClientDataContextValue["mergeIncomingConversationMessage"]
  updateConversationMessageState: (
    conversationId: string,
    updater: (state: ClientConversationMessageState) => ClientConversationMessageState,
  ) => void
}) {
  const { t } = useLocale()
  const sendConversationText = useCallback(
    async (
      conversationId: string,
      content: string,
      options: SendConversationMessageOptions = {},
    ) => {
      const trimmedContent = content.trim()
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || !trimmedContent || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationTextMessage(conversationId, {
          clientMessageId,
          content: trimmedContent,
          replyToMessageId: options.replyToMessageId,
        })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, t("data.sendMessageFailed")))
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

  const sendConversationMarkdown = useCallback(
    async (
      conversationId: string,
      content: string,
      options: SendConversationMessageOptions = {},
    ) => {
      const trimmedContent = content.trim()
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || !trimmedContent || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationMarkdownMessage(conversationId, {
          clientMessageId,
          content: trimmedContent,
          replyToMessageId: options.replyToMessageId,
        })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, t("data.sendRichTextFailed")))
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

  const sendConversationLink = useCallback(
    async (conversationId: string, url: string, options: SendConversationMessageOptions = {}) => {
      const trimmedURL = url.trim()
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || !trimmedURL || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationLinkMessage(conversationId, {
          clientMessageId,
          replyToMessageId: options.replyToMessageId,
          url: trimmedURL,
        })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, t("data.sendLinkFailed")))
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
