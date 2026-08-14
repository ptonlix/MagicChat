import * as React from "react"
import { Loader2Icon, Search, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { useLocale } from "@/components/locale-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ContactUser, FriendRequest } from "@/lib/client-data-api"
import { searchContactUsers } from "@/lib/client-data-api"
import { getClientDataErrorMessage } from "@/lib/client-data-state"

export function FriendManagementDialog({
  acceptRequest,
  cancelRequest,
  contacts,
  createRequest,
  currentUserId,
  ensureUsers,
  incomingRequests,
  onOpenChange,
  open,
  outgoingRequests,
  rejectRequest,
  usersById,
}: {
  acceptRequest: (requestId: string) => Promise<void>
  cancelRequest: (requestId: string) => Promise<void>
  contacts: readonly ContactUser[]
  createRequest: (userId: string) => Promise<void>
  currentUserId: string
  ensureUsers: (userIds: readonly string[]) => Promise<void>
  incomingRequests: readonly FriendRequest[]
  onOpenChange: (open: boolean) => void
  open: boolean
  outgoingRequests: readonly FriendRequest[]
  rejectRequest: (requestId: string) => Promise<void>
  usersById: Readonly<Record<string, ContactUser>>
}) {
  const { t } = useLocale()
  const [query, setQuery] = React.useState("")
  const [resultIds, setResultIds] = React.useState<string[]>([])
  const [searchError, setSearchError] = React.useState("")
  const [searching, setSearching] = React.useState(false)
  const [updatingKey, setUpdatingKey] = React.useState("")
  const friendIds = React.useMemo(
    () =>
      new Set(
        contacts.filter((contact) => contact.id !== currentUserId).map((contact) => contact.id),
      ),
    [contacts, currentUserId],
  )
  const pendingUserIds = React.useMemo(
    () =>
      new Set([
        ...incomingRequests
          .filter((request) => request.status === "pending")
          .map((request) => request.requesterUserId),
        ...outgoingRequests
          .filter((request) => request.status === "pending")
          .map((request) => request.addresseeUserId),
      ]),
    [incomingRequests, outgoingRequests],
  )
  const requestHistory = React.useMemo(
    () =>
      [
        ...incomingRequests.map((request) => ({
          direction: "incoming" as const,
          request,
          user:
            usersById[request.requesterUserId] ?? createPlaceholderUser(request.requesterUserId),
        })),
        ...outgoingRequests.map((request) => ({
          direction: "outgoing" as const,
          request,
          user:
            usersById[request.addresseeUserId] ?? createPlaceholderUser(request.addresseeUserId),
        })),
      ].sort(
        (left, right) => getRequestUpdatedAt(right.request) - getRequestUpdatedAt(left.request),
      ),
    [incomingRequests, outgoingRequests, usersById],
  )

  React.useEffect(() => {
    if (open) return
    setQuery("")
    setResultIds([])
    setSearchError("")
    setSearching(false)
    setUpdatingKey("")
  }, [open])

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value || searching) return
    setSearching(true)
    setSearchError("")
    try {
      const ids = await searchContactUsers(value)
      await ensureUsers(ids)
      setResultIds(ids)
    } catch (error) {
      const message = getClientDataErrorMessage(error, t("friend.searchFailed"))
      setSearchError(message)
      toast.error(message)
    } finally {
      setSearching(false)
    }
  }

  async function run(key: string, action: () => Promise<void>, success: string) {
    if (updatingKey) return
    setUpdatingKey(key)
    try {
      await action()
      toast.success(success)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, t("friend.actionFailed")))
    } finally {
      setUpdatingKey("")
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("friend.title")}</DialogTitle>
        </DialogHeader>
        <form className="flex shrink-0 gap-2" onSubmit={handleSearch}>
          <Input
            aria-label={t("friend.searchAria")}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("friend.searchPlaceholder")}
            type="search"
            value={query}
          />
          <Button disabled={searching || !query.trim()} type="submit">
            {searching ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <Search />}
            {t("friend.search")}
          </Button>
        </form>
        {searchError && (
          <p className="shrink-0 text-sm text-destructive" role="alert">
            {searchError}
          </p>
        )}
        {resultIds.length > 0 && (
          <section aria-label={t("friend.searchAria")} className="shrink-0">
            <div className="grid gap-2">
              {resultIds.map((id) => {
                if (id === currentUserId) return null
                const user = usersById[id] ?? createPlaceholderUser(id)
                const isFriend = friendIds.has(id)
                const hasPendingRequest = pendingUserIds.has(id)
                const unavailable = isFriend || hasPendingRequest
                return (
                  <FriendRow
                    action={
                      <Button
                        disabled={unavailable || Boolean(updatingKey)}
                        onClick={() =>
                          void run(`add:${id}`, () => createRequest(id), t("friend.requestSent"))
                        }
                        size="sm"
                        type="button"
                      >
                        <UserPlus aria-hidden="true" />
                        {isFriend
                          ? t("friend.alreadyFriend")
                          : hasPendingRequest
                            ? t("friend.pending")
                            : t("friend.add")}
                      </Button>
                    }
                    key={id}
                    user={user}
                  />
                )
              })}
            </div>
          </section>
        )}
        <section aria-label={t("friend.history")} className="flex min-h-0 flex-1 flex-col">
          <h3 className="shrink-0 pt-1 text-sm font-medium">{t("friend.history")}</h3>
          <div className="mt-2 min-h-0 overflow-y-auto pr-1">
            <div className="grid gap-2 pb-1">
              {requestHistory.map((item) => (
                <FriendRow
                  action={
                    item.request.status === "pending" ? (
                      item.direction === "incoming" ? (
                        <div className="flex gap-1">
                          <Button
                            disabled={Boolean(updatingKey)}
                            onClick={() =>
                              void run(
                                `reject:${item.request.id}`,
                                () => rejectRequest(item.request.id),
                                t("friend.rejected"),
                              )
                            }
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {updatingKey === `reject:${item.request.id}` && (
                              <Loader2Icon aria-hidden="true" className="animate-spin" />
                            )}
                            {t("friend.reject")}
                          </Button>
                          <Button
                            disabled={Boolean(updatingKey)}
                            onClick={() =>
                              void run(
                                `accept:${item.request.id}`,
                                () => acceptRequest(item.request.id),
                                t("friend.accepted"),
                              )
                            }
                            size="sm"
                            type="button"
                          >
                            {updatingKey === `accept:${item.request.id}` && (
                              <Loader2Icon aria-hidden="true" className="animate-spin" />
                            )}
                            {t("friend.accept")}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          disabled={Boolean(updatingKey)}
                          onClick={() =>
                            void run(
                              `cancel:${item.request.id}`,
                              () => cancelRequest(item.request.id),
                              t("friend.requestCanceled"),
                            )
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {updatingKey === `cancel:${item.request.id}` && (
                            <Loader2Icon aria-hidden="true" className="animate-spin" />
                          )}
                          {t("friend.cancelRequest")}
                        </Button>
                      )
                    ) : null
                  }
                  detail={t(
                    item.direction === "incoming"
                      ? "friend.direction.incoming"
                      : "friend.direction.outgoing",
                  )}
                  key={`${item.direction}:${item.request.id}`}
                  status={t(getFriendRequestStatusKey(item.request.status))}
                  user={item.user}
                />
              ))}
              {requestHistory.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("friend.empty.history")}
                </div>
              )}
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}

function FriendRow({
  action,
  detail,
  status,
  user,
}: {
  action: React.ReactNode
  detail?: string
  status?: string
  user: ContactUser
}) {
  const displayName = user.nickname || user.name || shortUserId(user.id)
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border p-3">
      <Avatar className="size-9 shrink-0">
        {user.avatar && <AvatarImage alt={displayName} src={user.avatar} />}
        <AvatarFallback>{Array.from(displayName)[0] ?? "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{displayName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {user.email || shortUserId(user.id)}
        </div>
        {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {status && <Badge variant="secondary">{status}</Badge>}
        {action}
      </div>
    </div>
  )
}

function getFriendRequestStatusKey(
  status: FriendRequest["status"],
):
  | "friend.status.accepted"
  | "friend.status.canceled"
  | "friend.status.pending"
  | "friend.status.rejected" {
  return `friend.status.${status}`
}

function getRequestUpdatedAt(request: FriendRequest) {
  const timestamp = Date.parse(request.updatedAt)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function shortUserId(userId: string) {
  return userId.length <= 12 ? userId : `${userId.slice(0, 8)}...${userId.slice(-4)}`
}

function createPlaceholderUser(id: string): ContactUser {
  return {
    avatar: "",
    email: "",
    id,
    lastOnlineAt: null,
    name: "",
    nickname: "",
    online: false,
    phone: "",
    type: "user",
  }
}
