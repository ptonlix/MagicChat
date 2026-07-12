import { useCallback, type RefObject } from "react"
import { toast } from "sonner"

import {
  sendConversationFileMessage,
  sendConversationImageMessage,
  sendConversationLinkMessage,
  sendConversationMarkdownMessage,
  sendConversationTextMessage,
} from "@/lib/client-data-api"
import type {
  ClientConversationMessageState,
  ClientDataContextValue,
  SendConversationMessageOptions,
} from "@/lib/client-data-context"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { createClientMessageId } from "@/lib/message-id"

export function useConversationSenders({
  conversationMessageStatesRef,
  mergeIncomingConversationMessage,
  updateConversationMessageState,
}: {
  conversationMessageStatesRef: RefObject<
    Record<string, ClientConversationMessageState>
  >
  mergeIncomingConversationMessage: ClientDataContextValue["mergeIncomingConversationMessage"]
  updateConversationMessageState: (
    conversationId: string,
    updater: (
      state: ClientConversationMessageState
    ) => ClientConversationMessageState
  ) => void
}) {
  const sendConversationText = useCallback(
    async (
      conversationId: string,
      content: string,
      options: SendConversationMessageOptions = {}
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
        toast.error(getClientDataErrorMessage(error, "发送消息失败"))
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
    ]
  )

  const sendConversationMarkdown = useCallback(
    async (
      conversationId: string,
      content: string,
      options: SendConversationMessageOptions = {}
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
        toast.error(getClientDataErrorMessage(error, "发送富文本消息失败"))
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
    ]
  )

  const sendConversationLink = useCallback(
    async (
      conversationId: string,
      url: string,
      options: SendConversationMessageOptions = {}
    ) => {
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
        toast.error(getClientDataErrorMessage(error, "发送链接失败"))
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
    ]
  )

  const sendConversationFile = useCallback(
    async (
      conversationId: string,
      file: File,
      options: SendConversationMessageOptions = {}
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
        const message = await sendConversationFileMessage(conversationId, {
          clientMessageId,
          file,
          replyToMessageId: options.replyToMessageId,
        })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, "发送文件失败"))
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
    ]
  )

  const sendConversationImage = useCallback(
    async (
      conversationId: string,
      image: File,
      options: SendConversationMessageOptions = {}
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
        const message = await sendConversationImageMessage(conversationId, {
          clientMessageId,
          image,
          replyToMessageId: options.replyToMessageId,
        })
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        toast.error(getClientDataErrorMessage(error, "发送图片失败"))
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
    ]
  )

  return {
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationText,
  }
}
