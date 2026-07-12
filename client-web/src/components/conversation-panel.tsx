import * as React from "react"
import { Upload } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type ClientConversation,
  type ClientMessage,
} from "@/lib/client-data-api"
import type { MentionLabelResolver } from "@/lib/message-mentions"
import type { ConversationDraftMention } from "@/lib/conversation-drafts"
import type {
  ConversationPanelComposerHandle,
  ConversationPanelMentionTarget,
  ConversationPanelMessage,
  ConversationPanelReplyTarget,
} from "@/lib/conversation-panel-types"
import { isAcceptedImageMessageMimeType } from "@/lib/image-message"
import { ConversationPanelComposer } from "@/components/conversation/conversation-panel-composer"
import { ConversationPanelHeader } from "@/components/conversation/conversation-panel-header"
import { ConversationPanelHistory } from "@/components/conversation/conversation-panel-history"

export type {
  ConversationPanelAppProfile,
  ConversationPanelComposerHandle,
  ConversationPanelMentionTarget,
  ConversationPanelMessage,
  ConversationPanelReplyTarget,
} from "@/lib/conversation-panel-types"

const fallbackMentionLabelResolver: MentionLabelResolver = () => undefined
const emptyDraftMentions: ConversationDraftMention[] = []

type DraggedFileKind = "file" | "image"

type ConversationPanelProps = {
  conversation: ClientConversation | null
  conversationOnline?: boolean
  currentUserId: string
  draft: string
  draftMentions?: ConversationDraftMention[]
  historyError: string | null
  historyLoading: boolean
  historyLoadingBefore: boolean
  mentionLabelResolver?: MentionLabelResolver
  messages: ConversationPanelMessage[]
  onDraftBlur?: () => void
  onDraftChange: (draft: string, mentions: ConversationDraftMention[]) => void
  onCancelReply: () => void
  onReplyToMessage: (message: ConversationPanelMessage) => void
  onRevokeMessage: (message: ConversationPanelMessage) => void
  onSendFile: (file: File) => Promise<ClientMessage | null>
  onSendImage: (image: File) => Promise<ClientMessage | null>
  onLoadBeforeMessages: () => void
  onRichTextModeChange: (richTextMode: boolean) => void
  onSendMessage: (content?: string) => void
  replyTarget: ConversationPanelReplyTarget | null
  richTextMode: boolean
  sending: boolean
}

export function ConversationPanel({
  conversation,
  conversationOnline,
  currentUserId,
  draft,
  draftMentions = emptyDraftMentions,
  historyError,
  historyLoading,
  historyLoadingBefore,
  mentionLabelResolver = fallbackMentionLabelResolver,
  messages,
  onDraftBlur,
  onDraftChange,
  onCancelReply,
  onReplyToMessage,
  onRevokeMessage,
  onSendFile,
  onSendImage,
  onLoadBeforeMessages,
  onRichTextModeChange,
  onSendMessage,
  replyTarget,
  richTextMode,
  sending,
}: ConversationPanelProps) {
  const composerRef = React.useRef<ConversationPanelComposerHandle | null>(null)
  const fileDragDepthRef = React.useRef(0)
  const [draggedFileKind, setDraggedFileKind] =
    React.useState<DraggedFileKind | null>(null)

  const insertComposerMention = React.useCallback(
    (target: ConversationPanelMentionTarget) => {
      if (conversation?.type !== "group") {
        composerRef.current?.focus()
        return
      }

      composerRef.current?.insertMention(target)
    },
    [conversation?.type]
  )

  const handleReplyToMessage = React.useCallback(
    (message: ConversationPanelMessage) => {
      onReplyToMessage(message)

      if (conversation?.type === "group" && message.mentionTarget) {
        composerRef.current?.insertMention(message.mentionTarget)
        return
      }

      composerRef.current?.focus()
    },
    [conversation?.type, onReplyToMessage]
  )

  function resetFileDrag() {
    fileDragDepthRef.current = 0
    setDraggedFileKind(null)
  }

  function handlePanelDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = conversation && !sending ? "copy" : "none"

    if (!conversation || sending) {
      return
    }

    fileDragDepthRef.current += 1
    setDraggedFileKind(getDraggedFileKind(event.dataTransfer))
  }

  function handlePanelDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = conversation && !sending ? "copy" : "none"
  }

  function handlePanelDragLeave(event: React.DragEvent<HTMLElement>) {
    if (fileDragDepthRef.current === 0) {
      return
    }

    event.preventDefault()
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1)

    if (fileDragDepthRef.current === 0) {
      setDraggedFileKind(null)
    }
  }

  function handlePanelDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    const file = event.dataTransfer.files[0]

    resetFileDrag()

    if (!conversation || sending || !file) {
      return
    }

    composerRef.current?.openDroppedFile(file)
  }

  return (
    <main
      className={cn(
        "relative flex min-w-0 flex-1 flex-col",
        conversation ? "bg-background" : "bg-muted"
      )}
      data-testid="chat-detail-shell"
      onDragEnter={handlePanelDragEnter}
      onDragLeave={handlePanelDragLeave}
      onDragOver={handlePanelDragOver}
      onDrop={handlePanelDrop}
    >
      {conversation ? (
        <>
          <ConversationPanelHeader
            conversation={conversation}
            currentUserId={currentUserId}
            online={conversationOnline}
          />
          <ConversationPanelHistory
            conversation={conversation}
            error={historyError}
            loading={historyLoading}
            loadingBefore={historyLoadingBefore}
            currentUserId={currentUserId}
            mentionLabelResolver={mentionLabelResolver}
            messages={messages}
            onLoadBeforeMessages={onLoadBeforeMessages}
            onInsertMention={insertComposerMention}
            onReplyToMessage={handleReplyToMessage}
            onRevokeMessage={onRevokeMessage}
          />
          <ConversationPanelComposer
            ref={composerRef}
            conversation={conversation}
            draft={draft}
            draftMentions={draftMentions}
            replyTarget={replyTarget}
            onCancelReply={onCancelReply}
            onDraftBlur={onDraftBlur}
            onDraftChange={onDraftChange}
            onSendFile={onSendFile}
            onSendImage={onSendImage}
            onSendMessage={onSendMessage}
            onRichTextModeChange={onRichTextModeChange}
            richTextMode={richTextMode}
            sending={sending}
          />
        </>
      ) : (
        <ConversationPanelEmptyState />
      )}
      {conversation && draggedFileKind && (
        <ConversationFileDropOverlay kind={draggedFileKind} />
      )}
    </main>
  )
}

function ConversationFileDropOverlay({ kind }: { kind: DraggedFileKind }) {
  const isImage = kind === "image"

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-teal-700/10 p-3 backdrop-blur-[2px]"
      data-testid="conversation-file-drop-overlay"
      role="status"
    >
      <div className="flex size-full max-h-60 max-w-100 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-teal-500 bg-background/60 text-teal-700 dark:text-teal-300">
        <span className="flex size-11 items-center justify-center rounded-full bg-teal-500/15">
          <Upload aria-hidden="true" className="size-5" />
        </span>
        <span className="text-sm font-medium">
          {isImage ? "松开发送图片" : "松开发送文件"}
        </span>
        <span className="text-xs text-muted-foreground">
          {isImage ? "支持 PNG、JPG 和 WebP" : "将作为附件发送"}
        </span>
      </div>
    </div>
  )
}

function ConversationPanelEmptyState() {
  return (
    <div
      className="flex flex-1 items-center justify-center self-stretch text-sm text-muted-foreground"
      data-testid="chat-empty-state"
    >
      选择一个会话开始聊天
    </div>
  )
}

function hasDraggedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files")
}

function getDraggedFileKind(dataTransfer: DataTransfer): DraggedFileKind {
  const firstFileItem = Array.from(dataTransfer.items).find(
    (item) => item.kind === "file"
  )

  return firstFileItem && isAcceptedImageMessageMimeType(firstFileItem.type)
    ? "image"
    : "file"
}
