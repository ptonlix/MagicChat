import * as React from "react"
import { Loader2Icon, Search, UserPlus, UserRound, UsersRound } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useLocale } from "@/components/locale-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ContactUser, FriendRequest } from "@/lib/client-data-api"
import { searchContactUsers } from "@/lib/client-data-api"
import { getClientDataErrorMessage } from "@/lib/client-data-state"

export function FriendManagementDialog({
  acceptRequest,
  cancelRequest,
  contacts,
  createRequest,
  currentUserId,
  deleteFriend,
  ensureUsers,
  incomingRequests,
  onOpenChange,
  onSelectUser,
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
  deleteFriend: (userId: string) => Promise<void>
  ensureUsers: (userIds: readonly string[]) => Promise<void>
  incomingRequests: readonly FriendRequest[]
  onOpenChange: (open: boolean) => void
  onSelectUser?: (userId: string) => void
  open: boolean
  outgoingRequests: readonly FriendRequest[]
  rejectRequest: (requestId: string) => Promise<void>
  usersById: Readonly<Record<string, ContactUser>>
}) {
  const { t } = useLocale()
  const [query, setQuery] = React.useState("")
  const [resultIds, setResultIds] = React.useState<string[]>([])
  const [searching, setSearching] = React.useState(false)
  const [updatingKey, setUpdatingKey] = React.useState("")
  const [friendToDelete, setFriendToDelete] = React.useState<ContactUser | null>(null)
  const friends = contacts.filter((contact) => contact.id !== currentUserId)
  const friendIds = new Set(friends.map((friend) => friend.id))
  const pendingIds = new Set([
    ...incomingRequests.map((request) => request.requesterUserId),
    ...outgoingRequests.map((request) => request.addresseeUserId),
  ])

  React.useEffect(() => {
    if (!open) setFriendToDelete(null)
  }, [open])

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value || searching) return
    setSearching(true)
    try {
      const ids = await searchContactUsers(value)
      await ensureUsers(ids)
      setResultIds(ids)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, t("friend.searchFailed")))
    } finally {
      setSearching(false)
    }
  }

  async function run(key: string, action: () => Promise<void>, success: string) {
    if (updatingKey) return false
    setUpdatingKey(key)
    try {
      await action()
      toast.success(success)
      return true
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, t("friend.actionFailed")))
      return false
    } finally {
      setUpdatingKey("")
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setFriendToDelete(null)
        onOpenChange(nextOpen)
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("friend.title")}</DialogTitle>
          <DialogDescription>{t("friend.description")}</DialogDescription>
        </DialogHeader>
        <Tabs className="min-h-0 flex-1" defaultValue="friends">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="friends">
              {t("friend.tab.friends", { count: friends.length })}
            </TabsTrigger>
            <TabsTrigger value="incoming">
              {t("friend.tab.incoming", { count: incomingRequests.length })}
            </TabsTrigger>
            <TabsTrigger value="outgoing">
              {t("friend.tab.outgoing", { count: outgoingRequests.length })}
            </TabsTrigger>
            <TabsTrigger value="search">{t("friend.tab.search")}</TabsTrigger>
          </TabsList>
          <FriendListTab
            empty={t("friend.empty.friends")}
            items={friends.map((user) => ({ key: user.id, user }))}
            onSelectUser={onSelectUser}
            renderAction={({ user }) =>
              user ? (
                <Button
                  disabled={Boolean(updatingKey)}
                  onClick={() => setFriendToDelete(user)}
                  size="sm"
                  variant="outline"
                >
                  {t("friend.delete")}
                </Button>
              ) : null
            }
            value="friends"
          />
          <FriendListTab
            empty={t("friend.empty.incoming")}
            items={incomingRequests.map((request) => ({
              key: request.id,
              request,
              user:
                usersById[request.requesterUserId] ??
                createPlaceholderUser(request.requesterUserId),
            }))}
            onSelectUser={onSelectUser}
            renderAction={({ request }) =>
              request ? (
                <div className="flex gap-2">
                  <Button
                    disabled={Boolean(updatingKey)}
                    onClick={() =>
                      void run(request.id, () => rejectRequest(request.id), t("friend.rejected"))
                    }
                    size="sm"
                    variant="outline"
                  >
                    {t("friend.reject")}
                  </Button>
                  <Button
                    disabled={Boolean(updatingKey)}
                    onClick={() =>
                      void run(request.id, () => acceptRequest(request.id), t("friend.accepted"))
                    }
                    size="sm"
                  >
                    {t("friend.accept")}
                  </Button>
                </div>
              ) : null
            }
            value="incoming"
          />
          <FriendListTab
            empty={t("friend.empty.outgoing")}
            items={outgoingRequests.map((request) => ({
              key: request.id,
              request,
              user:
                usersById[request.addresseeUserId] ??
                createPlaceholderUser(request.addresseeUserId),
            }))}
            onSelectUser={onSelectUser}
            renderAction={({ request }) =>
              request ? (
                <Button
                  disabled={Boolean(updatingKey)}
                  onClick={() =>
                    void run(
                      request.id,
                      () => cancelRequest(request.id),
                      t("friend.requestCanceled"),
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  {t("friend.cancelRequest")}
                </Button>
              ) : null
            }
            value="outgoing"
          />
          <TabsContent className="min-h-0 overflow-y-auto pt-4" value="search">
            <form className="flex gap-2" onSubmit={handleSearch}>
              <Input
                aria-label={t("friend.searchAria")}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("friend.searchPlaceholder")}
                value={query}
              />
              <Button disabled={searching || !query.trim()} type="submit">
                {searching ? <Loader2Icon className="animate-spin" /> : <Search />}
                {t("friend.search")}
              </Button>
            </form>
            <div className="mt-4 grid gap-2">
              {resultIds.map((id) => {
                if (id === currentUserId) return null
                const user = usersById[id] ?? createPlaceholderUser(id)
                const unavailable = friendIds.has(id) || pendingIds.has(id)
                return (
                  <FriendRow
                    action={
                      <Button
                        disabled={unavailable || Boolean(updatingKey)}
                        onClick={() =>
                          void run(`add:${id}`, () => createRequest(id), t("friend.requestSent"))
                        }
                        size="sm"
                      >
                        <UserPlus />
                        {friendIds.has(id)
                          ? t("friend.alreadyFriend")
                          : pendingIds.has(id)
                            ? t("friend.pending")
                            : t("friend.add")}
                      </Button>
                    }
                    key={id}
                    onSelectUser={onSelectUser ? () => onSelectUser(id) : undefined}
                    user={user}
                  />
                )
              })}
              {!searching && resultIds.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
                  <UsersRound className="size-8" />
                  {t("friend.searchHint")}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setFriendToDelete(null)
        }}
        open={friendToDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("friend.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("friend.deleteDescription", {
                name:
                  friendToDelete?.nickname ||
                  friendToDelete?.name ||
                  (friendToDelete ? shortUserId(friendToDelete.id) : ""),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(updatingKey)}>
              {t("friend.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(updatingKey)}
              onClick={(event) => {
                event.preventDefault()
                if (!friendToDelete) return
                void run(
                  `delete:${friendToDelete.id}`,
                  () => deleteFriend(friendToDelete.id),
                  t("friend.deleted"),
                ).then((succeeded) => {
                  if (succeeded) setFriendToDelete(null)
                })
              }}
              variant="destructive"
            >
              {updatingKey === `delete:${friendToDelete?.id ?? ""}` && (
                <Loader2Icon aria-hidden="true" className="animate-spin" />
              )}
              {t("friend.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

type FriendListItem = { key: string; request?: FriendRequest; user?: ContactUser }

function FriendListTab({
  empty,
  items,
  onSelectUser,
  renderAction,
  value,
}: {
  empty: string
  items: readonly FriendListItem[]
  onSelectUser?: (userId: string) => void
  renderAction: (item: FriendListItem) => React.ReactNode
  value: string
}) {
  return (
    <TabsContent className="min-h-0 overflow-y-auto pt-4" value={value}>
      <div className="grid gap-2">
        {items.map((item) => {
          const user = item.user
          return user ? (
            <FriendRow
              action={renderAction(item)}
              key={item.key}
              onSelectUser={onSelectUser ? () => onSelectUser(user.id) : undefined}
              user={user}
            />
          ) : null
        })}
        {items.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">{empty}</div>
        )}
      </div>
    </TabsContent>
  )
}

function FriendRow({
  action,
  onSelectUser,
  user,
}: {
  action: React.ReactNode
  onSelectUser?: () => void
  user: ContactUser
}) {
  const { t } = useLocale()
  const displayName = user.nickname || user.name || shortUserId(user.id)
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border p-3">
      <Avatar className="size-9">
        {user.avatar && <AvatarImage alt={displayName} src={user.avatar} />}
        <AvatarFallback>{Array.from(displayName)[0] ?? "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{displayName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {user.email || shortUserId(user.id)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onSelectUser && (
          <Button
            aria-label={t("friend.viewProfile")}
            onClick={onSelectUser}
            size="icon-sm"
            title={t("friend.viewProfile")}
            type="button"
            variant="ghost"
          >
            <UserRound />
          </Button>
        )}
        {action}
      </div>
    </div>
  )
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
