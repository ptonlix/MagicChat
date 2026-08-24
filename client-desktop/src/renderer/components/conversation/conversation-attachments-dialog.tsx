import * as React from "react"
import { FolderClosed, LoaderCircle } from "lucide-react"

import {
  listConversationAttachments,
  type ClientConversation,
  type ClientConversationAttachment,
} from "@/lib/client-data-api"
import { formatActivityTime } from "@/lib/activity-time"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { MessageAttachment } from "@/components/message-attachment"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const pageLimit = 50

export function ConversationAttachmentsDialog({
  conversation,
}: {
  conversation: ClientConversation
}) {
  const [open, setOpen] = React.useState(false)
  const [attachments, setAttachments] = React.useState<ClientConversationAttachment[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState("")
  const requestVersion = React.useRef(0)
  const requestController = React.useRef<AbortController | null>(null)
  const previousConversationId = React.useRef(conversation.id)

  const cancelRequest = React.useCallback(() => {
    requestVersion.current += 1
    requestController.current?.abort()
    requestController.current = null
  }, [])

  const load = React.useCallback(
    async (cursor?: string, append = false) => {
      requestController.current?.abort()
      const controller = new AbortController()
      requestController.current = controller
      const version = ++requestVersion.current
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError("")
      try {
        const page = await listConversationAttachments(conversation.id, {
          cursor,
          limit: pageLimit,
          signal: controller.signal,
        })
        if (controller.signal.aborted || requestVersion.current !== version) return
        setAttachments((current) =>
          append ? mergeAttachments(current, page.attachments) : page.attachments,
        )
        setNextCursor(page.nextCursor)
      } catch (reason) {
        if (!controller.signal.aborted && requestVersion.current === version)
          setError(getClientDataErrorMessage(reason, "加载历史附件失败"))
      } finally {
        if (requestController.current === controller && requestVersion.current === version) {
          setLoading(false)
          setLoadingMore(false)
          requestController.current = null
        }
      }
    },
    [conversation.id],
  )

  React.useEffect(
    () => () => {
      cancelRequest()
    },
    [cancelRequest, conversation.id],
  )

  React.useEffect(() => {
    if (previousConversationId.current === conversation.id) return
    previousConversationId.current = conversation.id
    cancelRequest()
    if (!open) return
    setAttachments([])
    setNextCursor(null)
    void load()
  }, [cancelRequest, conversation.id, load, open])

  function changeOpen(nextOpen: boolean) {
    cancelRequest()
    setOpen(nextOpen)
    setLoadingMore(false)
    if (nextOpen) {
      setAttachments([])
      setNextCursor(null)
      void load()
    } else setLoading(false)
  }

  if (conversation.type === "topic") return null

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        <Button aria-label="历史附件" size="icon-sm" title="历史附件" type="button" variant="ghost">
          <FolderClosed className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] min-w-0 flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>历史附件</DialogTitle>
        </DialogHeader>
        <div className="min-h-40 min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <Status>
              <LoaderCircle className="size-5 animate-spin" />
              正在加载历史附件
            </Status>
          ) : error && attachments.length === 0 ? (
            <Status>
              <span>{error}</span>
              <Button onClick={() => void load()} size="sm" variant="outline">
                重试
              </Button>
            </Status>
          ) : attachments.length === 0 ? (
            <Status>
              <FolderClosed className="size-8 opacity-50" />
              暂无历史附件
            </Status>
          ) : (
            <div className="grid gap-1">
              {attachments.map((attachment) => (
                <AttachmentRow
                  attachment={attachment}
                  key={`${attachment.messageId}:${attachment.file.fileId}`}
                />
              ))}
              {error && <p className="px-3 py-2 text-center text-xs text-destructive">{error}</p>}
            </div>
          )}
        </div>
        {nextCursor && !loading && (
          <Button
            disabled={loadingMore}
            onClick={() => void load(nextCursor, true)}
            type="button"
            variant="outline"
          >
            {loadingMore && <LoaderCircle className="size-4 animate-spin" />}加载更多
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AttachmentRow({ attachment }: { attachment: ClientConversationAttachment }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md px-3 py-3 hover:bg-muted">
      <div className="min-w-0 flex-1">
        <MessageAttachment file={attachment.file} />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatActivityTime(attachment.createdAt)}
      </span>
    </div>
  )
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function mergeAttachments(
  current: ClientConversationAttachment[],
  incoming: ClientConversationAttachment[],
) {
  const ids = new Set(current.map((item) => `${item.messageId}:${item.file.fileId}`))
  return [
    ...current,
    ...incoming.filter((item) => !ids.has(`${item.messageId}:${item.file.fileId}`)),
  ]
}
