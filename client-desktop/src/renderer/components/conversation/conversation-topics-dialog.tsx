import * as React from "react"
import { LoaderCircle, MessagesSquare } from "lucide-react"

import { listConversationTopics, type ClientConversation } from "@/lib/client-data-api"
import { formatActivityTime } from "@/lib/activity-time"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const pageLimit = 50

export function ConversationTopicsDialog({
  conversation,
  onOpenTopic,
}: {
  conversation: ClientConversation
  onOpenTopic: (conversationId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [topics, setTopics] = React.useState<ClientConversation[]>([])
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
        const page = await listConversationTopics(conversation.id, {
          cursor,
          limit: pageLimit,
          signal: controller.signal,
        })
        if (controller.signal.aborted || requestVersion.current !== version) return
        setTopics((current) => (append ? mergeTopics(current, page.topics) : page.topics))
        setNextCursor(page.nextCursor)
      } catch (reason) {
        if (!controller.signal.aborted && requestVersion.current === version) {
          setError(getClientDataErrorMessage(reason, "加载话题列表失败"))
        }
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
    setTopics([])
    setNextCursor(null)
    void load()
  }, [cancelRequest, conversation.id, load, open])

  function changeOpen(nextOpen: boolean) {
    cancelRequest()
    setOpen(nextOpen)
    setLoadingMore(false)
    if (nextOpen) {
      setTopics([])
      setNextCursor(null)
      void load()
    } else {
      setLoading(false)
    }
  }

  if (conversation.type === "topic") return null

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        <Button aria-label="话题" size="icon-sm" title="话题" type="button" variant="ghost">
          <MessagesSquare className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] min-w-0 flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>会话话题</DialogTitle>
        </DialogHeader>
        <div className="min-h-40 min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <Status>
              <LoaderCircle className="size-5 animate-spin" />
              正在加载话题
            </Status>
          ) : error && topics.length === 0 ? (
            <Status>
              <span>{error}</span>
              <Button onClick={() => void load()} size="sm" variant="outline">
                重试
              </Button>
            </Status>
          ) : topics.length === 0 ? (
            <Status>
              <MessagesSquare className="size-8 opacity-50" />
              暂无话题
            </Status>
          ) : (
            <div className="grid gap-1">
              {topics.map((topic) => (
                <button
                  aria-label={getTopicAccessibleName(topic)}
                  className="flex min-w-0 items-start gap-3 rounded-md px-3 py-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  key={topic.id}
                  onClick={() => {
                    setOpen(false)
                    cancelRequest()
                    onOpenTopic(topic.id)
                  }}
                  type="button"
                >
                  <MessagesSquare className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{topic.name}</span>
                      {topic.unreadCount > 0 && (
                        <span className="shrink-0 text-xs text-primary">
                          未读 {topic.unreadCount}
                        </span>
                      )}
                      {topic.topic?.participating && (
                        <span className="shrink-0 text-xs text-muted-foreground">已参与</span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {topic.lastMessageSummary || "暂无回复"}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {topic.topic?.archived ? "已关闭" : "进行中"} ·{" "}
                      {formatActivityTime(topic.lastMessageAt ?? topic.createdAt)}
                    </span>
                  </span>
                </button>
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

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function mergeTopics(current: ClientConversation[], incoming: ClientConversation[]) {
  const ids = new Set(current.map((topic) => topic.id))
  return [...current, ...incoming.filter((topic) => !ids.has(topic.id))]
}

function getTopicAccessibleName(topic: ClientConversation) {
  const states = [topic.topic?.archived ? "已关闭" : "进行中"]
  if (topic.topic?.participating) states.push("已参与")
  if (topic.unreadCount > 0) states.push(`未读 ${topic.unreadCount}`)
  return `打开话题：${topic.name}，${states.join("，")}`
}
