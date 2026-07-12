import * as React from "react"
import { toast } from "sonner"
import { getAvatarInitial } from "@/lib/avatar"
import { cn } from "@/lib/utils"
import {
  formatClientMessageBodySummary,
  type ClientConversation,
} from "@/lib/client-data-api"
import {
  formatMentionTemplateText,
  parseMentionTemplate,
  type MentionLabelResolver,
} from "@/lib/message-mentions"
import { AppProfilePopover } from "@/components/app-profile-popover"
import { MessageAttachment } from "@/components/message-attachment"
import { MessageImage } from "@/components/message-image"
import { MessageTextWithLinks } from "@/components/message-inline-link"
import { MessageLink } from "@/components/message-link"
import { MessageMarkdown } from "@/components/message-markdown"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { MessageActionMenu } from "@/components/message-action-menu"
import { UserProfilePopover } from "@/components/user-profile-popover"
import type {
  ConversationPanelMentionTarget,
  ConversationPanelMessage,
  ConversationPanelReplyTarget,
} from "@/lib/conversation-panel-types"

export function SystemMessageBadge({
  currentUserId,
  mentionLabelResolver,
  message,
}: {
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  message: ConversationPanelMessage
}) {
  return (
    <div className="flex justify-center">
      <Badge
        className="h-auto max-w-[min(80%,36rem)] text-center leading-relaxed whitespace-normal"
        variant="secondary"
      >
        <MessageBodyRenderer
          body={message.body}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver}
        />
      </Badge>
    </div>
  )
}

export function MessageBubble({
  message,
  conversation,
  currentUserId,
  mentionLabelResolver,
  onInsertMention,
  onReply,
  onRevoke,
}: {
  message: ConversationPanelMessage
  conversation: ClientConversation
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  onInsertMention: (target: ConversationPanelMentionTarget) => void
  onReply: (message: ConversationPanelMessage) => void
  onRevoke: (message: ConversationPanelMessage) => void
}) {
  const fromMe = message.role === "me"
  const fallback = fromMe ? "我" : getAvatarInitial(conversation.name)
  const canInsertAuthorMention =
    conversation.type === "group" && message.mentionTarget !== null
  const copyText = getMessageCopyText(message, mentionLabelResolver)
  const bubbleRef = React.useRef<HTMLDivElement | null>(null)
  const selectedCopyTextRef = React.useRef("")

  function handleMessageContextMenu() {
    selectedCopyTextRef.current = getSelectedTextWithinElement(
      bubbleRef.current
    )
  }

  function handleCopyMessage() {
    const selectedText = selectedCopyTextRef.current
    selectedCopyTextRef.current = ""

    void copyMessageToClipboard(
      message,
      selectedText,
      bubbleRef.current,
      mentionLabelResolver
    )
  }

  function handleAuthorMentionClick() {
    if (!message.mentionTarget) {
      return
    }

    onInsertMention(message.mentionTarget)
  }

  return (
    <div className={cn("flex gap-3", fromMe ? "justify-end" : "justify-start")}>
      {!fromMe && <MessageAvatar fallback={fallback} message={message} />}
      <div
        className={cn(
          "flex max-w-[min(70%,64rem)] flex-col gap-1",
          fromMe ? "items-end" : "items-start"
        )}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {canInsertAuthorMention ? (
            <button
              className="cursor-pointer p-0 text-muted-foreground transition-colors hover:text-sky-500"
              onClick={handleAuthorMentionClick}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              {message.author}
            </button>
          ) : (
            <span>{message.author}</span>
          )}
          <span>{message.time}</span>
        </div>
        <MessageActionMenu
          canRevoke={message.canRevoke}
          copyDisabled={!copyText}
          onCopy={handleCopyMessage}
          onReply={() => onReply(message)}
          onRevoke={() => onRevoke(message)}
        >
          <div
            className={cn(
              "max-w-full rounded-md p-3 text-sm leading-relaxed shadow-xs",
              fromMe
                ? "bg-teal-100 text-foreground hover:bg-teal-200/70 data-[state=open]:bg-teal-200/70 dark:bg-teal-950 hover:dark:bg-teal-900/70 dark:data-[state=open]:bg-teal-900/70"
                : "bg-zinc-200/60 text-foreground hover:bg-zinc-200/80 data-[state=open]:bg-zinc-200 dark:bg-zinc-800/80 hover:dark:bg-zinc-800 dark:data-[state=open]:bg-zinc-800"
            )}
            data-message-action-trigger
            onContextMenu={handleMessageContextMenu}
            ref={bubbleRef}
          >
            {message.replyTo && (
              <MessageReplyReference replyTo={message.replyTo} />
            )}
            <MessageBodyRenderer
              body={message.body}
              currentUserId={currentUserId}
              mentionLabelResolver={mentionLabelResolver}
            />
          </div>
        </MessageActionMenu>
        {message.delegatedByName && (
          <div className="text-xs text-muted-foreground">
            由 {message.delegatedByName} 代发
          </div>
        )}
      </div>
      {fromMe && (
        <MessageAvatar
          fallback="我"
          fallbackClassName="bg-primary text-primary-foreground"
          message={message}
        />
      )}
    </div>
  )
}

async function copyMessageToClipboard(
  message: ConversationPanelMessage,
  selectedText: string,
  messageElement: HTMLElement | null,
  mentionLabelResolver: MentionLabelResolver
) {
  const text =
    (selectedText.trim()
      ? selectedText
      : getSelectedTextWithinElement(messageElement)) ||
    getMessageCopyText(message, mentionLabelResolver)
  if (!text) {
    toast.error("没有可复制内容")
    return
  }

  try {
    await writeClipboardText(text)
    toast.success("已复制")
  } catch {
    toast.error("复制失败")
  }
}

function getSelectedTextWithinElement(element: HTMLElement | null) {
  if (!element) {
    return ""
  }

  const selection = window.getSelection()
  const selectedText = selection?.toString() ?? ""
  if (!selection || selection.isCollapsed || !selectedText.trim()) {
    return ""
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (rangeIntersectsElement(selection.getRangeAt(index), element)) {
      return selectedText
    }
  }

  return ""
}

function rangeIntersectsElement(range: Range, element: HTMLElement) {
  try {
    return range.intersectsNode(element)
  } catch {
    return false
  }
}

function getMessageCopyText(
  message: ConversationPanelMessage,
  mentionLabelResolver: MentionLabelResolver
) {
  switch (message.body.type) {
    case "file":
      return message.body.name
    case "image":
      return ""
    case "revoked":
      return ""
    case "link":
      return message.body.url
    case "markdown":
    case "text":
      return formatMentionTemplateText(
        message.body.content,
        mentionLabelResolver
      )
    case "system_event":
      return formatClientMessageBodySummary(message.body)
  }
}

async function writeClipboardText(text: string) {
  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    throw new Error("clipboard is unavailable")
  }

  await navigator.clipboard.writeText(text)
}

function MessageReplyReference({
  replyTo,
}: {
  replyTo: ConversationPanelReplyTarget
}) {
  return (
    <div className="mb-2 border-l-2 border-foreground/20 pl-2 text-xs">
      <div className="truncate font-medium text-foreground/80">
        {replyTo.author}
      </div>
      <div className="line-clamp-2 text-muted-foreground">
        {replyTo.summary}
      </div>
    </div>
  )
}

function MessageAvatar({
  fallback,
  fallbackClassName,
  message,
}: {
  fallback: string
  fallbackClassName?: string
  message: ConversationPanelMessage
}) {
  const avatar = (
    <Avatar className="mt-1 size-8 rounded-sm bg-muted after:rounded-sm">
      {message.avatar && (
        <AvatarImage
          alt={message.author}
          className="rounded-sm"
          src={message.avatar}
        />
      )}
      <AvatarFallback className={cn("rounded-sm", fallbackClassName)}>
        {fallback}
      </AvatarFallback>
    </Avatar>
  )

  return <MessageAvatarProfile message={message}>{avatar}</MessageAvatarProfile>
}

function MessageAvatarProfile({
  children,
  message,
}: {
  children: React.ReactNode
  message: ConversationPanelMessage
}) {
  if (message.senderAppId) {
    return (
      <AppProfilePopover
        appId={message.senderAppId}
        fallbackProfile={message.senderAppProfile}
        triggerAriaLabel={`${message.author}资料`}
      >
        {children}
      </AppProfilePopover>
    )
  }

  return (
    <UserProfilePopover userId={message.senderUserId}>
      {children}
    </UserProfilePopover>
  )
}

function MessageBodyRenderer({
  body,
  currentUserId,
  mentionLabelResolver,
}: {
  body: ConversationPanelMessage["body"]
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
}) {
  switch (body.type) {
    case "file":
      return <MessageAttachment file={body} />
    case "image":
      return <MessageImage image={body} />
    case "link":
      return <MessageLink link={body} />
    case "markdown":
      return (
        <MessageMarkdown
          content={body.content}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver}
        />
      )
    case "text":
      return (
        <TextMessageBody
          content={body.content}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver}
        />
      )
    case "revoked":
      return <span className="text-muted-foreground">该消息已被撤回</span>
    case "system_event":
      return <span>{formatClientMessageBodySummary(body)}</span>
  }
}

function TextMessageBody({
  content,
  currentUserId,
  mentionLabelResolver,
}: {
  content: string
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
}) {
  const parts = parseMentionTemplate(content, mentionLabelResolver)

  return (
    <span className="break-all whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.type === "text" ? (
          <MessageTextWithLinks key={`text-${index}`} text={part.text} />
        ) : (
          <MentionTextPart
            key={`${part.targetType}-${part.id}-${index}`}
            currentUserId={currentUserId}
            part={part}
          />
        )
      )}
    </span>
  )
}

function MentionTextPart({
  currentUserId,
  part,
}: {
  currentUserId: string
  part: Extract<
    ReturnType<typeof parseMentionTemplate>[number],
    { type: "mention" }
  >
}) {
  const isCurrentUserMention =
    part.targetType === "all" ||
    (part.targetType === "user" && isSameUserId(part.id, currentUserId))
  const content = (
    <span className={getMentionTextClassName(isCurrentUserMention)}>
      {part.label}
    </span>
  )

  if (part.targetType !== "user") {
    if (part.targetType === "app") {
      return (
        <AppProfilePopover
          appId={part.id}
          fallbackProfile={{
            avatar: "",
            description: "",
            id: part.id,
            name: part.label.replace(/^@/, ""),
            online: false,
          }}
        >
          {content}
        </AppProfilePopover>
      )
    }

    return content
  }

  return <UserProfilePopover userId={part.id}>{content}</UserProfilePopover>
}

function getMentionTextClassName(isCurrentUserMention: boolean) {
  return isCurrentUserMention
    ? "mx-0.5 font-medium text-amber-600 hover:text-amber-700"
    : "mx-0.5 font-medium text-sky-500 hover:text-sky-600"
}

function isSameUserId(userId: string | undefined, currentUserId: string) {
  return userId?.toLowerCase() === currentUserId.toLowerCase()
}
