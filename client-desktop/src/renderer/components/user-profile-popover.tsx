import * as React from "react"
import { useNavigate } from "react-router"
import { Loader2Icon, Mail, Phone, UserPen, UserRound } from "lucide-react"
import { toast } from "sonner"

import type { ContactDirectoryMode, FriendRequest } from "@/lib/client-data-api"
import { formatContactPhone } from "@/lib/contact-format"
import { useClientData, useClientUser } from "@/lib/client-data-context"
import { cn } from "@/lib/utils"
import { AvatarPreviewDialog } from "@/components/avatar-preview-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type UserProfilePopoverProps = {
  children: React.ReactNode
  fallbackProfile?: UserProfile | null
  triggerAriaLabel?: string
  triggerClassName?: string
  userId: string | null
}

export type UserProfile = {
  avatar: string
  email: string
  id: string
  name: string
  nickname: string
  phone: string
}

export function UserProfilePopoverLink({
  profile,
  triggerClassName,
}: {
  profile: UserProfile
  triggerClassName?: string
}) {
  const displayName = getUserDisplayName(profile)

  return (
    <UserProfilePopover
      fallbackProfile={profile}
      triggerAriaLabel={`${displayName}资料`}
      triggerClassName={cn(
        "max-w-full truncate transition-colors hover:text-sky-500 focus-visible:text-sky-500 data-[state=open]:text-sky-500",
        triggerClassName,
      )}
      userId={profile.id}
    >
      <span className="truncate">{displayName}</span>
    </UserProfilePopover>
  )
}

export function UserProfilePopover({
  children,
  fallbackProfile = null,
  triggerAriaLabel,
  triggerClassName,
  userId,
}: UserProfilePopoverProps) {
  const {
    acceptFriendRequest,
    contactDirectoryMode,
    contacts,
    createFriendRequest,
    incomingFriendRequests = [],
    me,
    openDirectConversation,
    outgoingFriendRequests = [],
  } = useClientData()
  const cachedUser = useClientUser(userId ?? "")
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [avatarPreviewOpen, setAvatarPreviewOpen] = React.useState(false)
  const [friendRequestPending, setFriendRequestPending] = React.useState(false)
  const [openingConversation, setOpeningConversation] = React.useState(false)
  const user = React.useMemo(
    () => resolveUserProfile(userId, me, contacts, cachedUser ?? fallbackProfile),
    [cachedUser, contacts, fallbackProfile, me, userId],
  )
  const relationship = React.useMemo(
    () =>
      resolveUserRelationship(
        {
          contactDirectoryMode,
          contacts,
          incomingFriendRequests,
          outgoingFriendRequests,
        },
        userId ?? "",
        me.id,
      ),
    [contactDirectoryMode, contacts, incomingFriendRequests, me.id, outgoingFriendRequests, userId],
  )

  if (!user) {
    return <>{children}</>
  }

  const profile = user
  const displayName = getUserDisplayName(profile)
  const canStartConversation = profile.id !== me.id && relationship.isFriend

  async function handleStartConversation() {
    if (!canStartConversation || openingConversation) {
      return
    }

    setOpeningConversation(true)

    try {
      const conversation = await openDirectConversation(profile.id)
      setOpen(false)
      navigate(`/chat/${encodeURIComponent(conversation.id)}`)
    } catch {
      toast.error("无法发起私聊")
    } finally {
      setOpeningConversation(false)
    }
  }

  async function handleAddFriend() {
    if (!createFriendRequest || friendRequestPending) return
    setFriendRequestPending(true)
    try {
      await createFriendRequest(profile.id)
      toast.success("好友申请已发送")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送好友申请失败")
    } finally {
      setFriendRequestPending(false)
    }
  }

  async function handleAcceptFriend() {
    if (!acceptFriendRequest || !relationship.incomingRequest || friendRequestPending) return
    setFriendRequestPending(true)
    try {
      await acceptFriendRequest(relationship.incomingRequest.id)
      toast.success("已添加好友")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "接受好友申请失败")
    } finally {
      setFriendRequestPending(false)
    }
  }

  function handleProfileAction() {
    if (relationship.incomingRequest) {
      void handleAcceptFriend()
    } else if (!relationship.isFriend) {
      void handleAddFriend()
    } else {
      void handleStartConversation()
    }
  }

  const profileActionLabel = relationship.incomingRequest
    ? "接受好友申请"
    : relationship.outgoingRequest
      ? "已发送好友申请"
      : relationship.isFriend
        ? "发消息"
        : "加好友"
  const profileActionDisabled =
    Boolean(relationship.outgoingRequest) ||
    openingConversation ||
    friendRequestPending ||
    (relationship.incomingRequest
      ? !acceptFriendRequest
      : !relationship.isFriend && !createFriendRequest)

  function handleAvatarPreview() {
    setOpen(false)
    setAvatarPreviewOpen(true)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={triggerAriaLabel}
          className={cn(
            "inline-flex cursor-pointer appearance-none rounded-sm border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            triggerClassName,
          )}
          type="button"
        >
          {children}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-[calc(100vh-2rem)] w-[min(18rem,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto"
          side="right"
          sideOffset={8}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <button
                aria-haspopup="dialog"
                aria-label={`预览${displayName}头像`}
                className="shrink-0 cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={handleAvatarPreview}
                type="button"
              >
                <Avatar className="size-14 rounded-sm bg-muted after:rounded-sm">
                  {profile.avatar && (
                    <AvatarImage alt={displayName} className="rounded-sm" src={profile.avatar} />
                  )}
                  <AvatarFallback className="rounded-sm text-lg">
                    {getUserInitial(displayName)}
                  </AvatarFallback>
                </Avatar>
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={displayName}>
                  {displayName}
                </div>
                <div className="truncate text-xs text-muted-foreground">用户资料</div>
              </div>
            </div>

            <div className="grid gap-1 text-sm">
              <UserProfileRow
                icon={<UserRound className="size-4 text-muted-foreground" />}
                label="姓名"
                value={profile.name}
              />
              <UserProfileRow
                icon={<UserPen className="size-4 text-muted-foreground" />}
                label="昵称"
                value={profile.nickname}
              />
              <UserProfileRow
                icon={<Mail className="size-4 text-muted-foreground" />}
                label="邮箱"
                value={profile.email}
              />
              <UserProfileRow
                icon={<Phone className="size-4 text-muted-foreground" />}
                label="手机"
                value={profile.phone ? formatContactPhone(profile.phone) : ""}
              />
            </div>

            {profile.id !== me.id ? (
              <Button
                className="w-full"
                disabled={profileActionDisabled}
                onClick={handleProfileAction}
                type="button"
              >
                {(openingConversation || friendRequestPending) && (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                )}
                {profileActionLabel}
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <AvatarPreviewDialog
        label={`${displayName}头像预览`}
        onOpenChange={setAvatarPreviewOpen}
        open={avatarPreviewOpen}
      >
        <Avatar className="size-full rounded-sm bg-muted after:rounded-sm">
          {profile.avatar && (
            <AvatarImage alt={displayName} className="rounded-sm" src={profile.avatar} />
          )}
          <AvatarFallback className="rounded-sm text-6xl">
            {getUserInitial(displayName)}
          </AvatarFallback>
        </Avatar>
      </AvatarPreviewDialog>
    </>
  )
}

type UserRelationshipSource = {
  contactDirectoryMode?: ContactDirectoryMode
  contacts: readonly Pick<UserProfile, "id">[]
  incomingFriendRequests: readonly FriendRequest[]
  outgoingFriendRequests: readonly FriendRequest[]
}

function resolveUserRelationship(
  source: UserRelationshipSource,
  userId: string,
  currentUserId: string,
) {
  const normalizedUserId = normalizeProfileId(userId)
  const normalizedCurrentUserId = normalizeProfileId(currentUserId)
  const incomingRequest =
    source.incomingFriendRequests.find(
      (request) =>
        request.status === "pending" &&
        normalizeProfileId(request.requesterUserId) === normalizedUserId &&
        normalizeProfileId(request.addresseeUserId) === normalizedCurrentUserId,
    ) ?? null
  const outgoingRequest =
    source.outgoingFriendRequests.find(
      (request) =>
        request.status === "pending" &&
        normalizeProfileId(request.addresseeUserId) === normalizedUserId &&
        normalizeProfileId(request.requesterUserId) === normalizedCurrentUserId,
    ) ?? null
  const isFriend =
    normalizedUserId === normalizedCurrentUserId ||
    source.contactDirectoryMode !== "friends" ||
    source.contacts.some((contact) => normalizeProfileId(contact.id) === normalizedUserId)

  return { incomingRequest, isFriend, outgoingRequest }
}

function normalizeProfileId(profileId: string) {
  return profileId.trim().toLowerCase()
}

function resolveUserProfile(
  userId: string | null,
  me: UserProfile,
  contacts: UserProfile[],
  fallbackProfile: UserProfile | null,
) {
  if (!userId) {
    return null
  }

  if (me.id === userId) {
    return me
  }

  return (
    contacts.find((contact) => contact.id === userId) ??
    (fallbackProfile?.id === userId ? fallbackProfile : null)
  )
}

function UserProfileRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  const hasValue = Boolean(value.trim())
  const displayValue = hasValue ? value : "未设置"

  return (
    <div className="flex items-center gap-3 border-b py-2 last:border-b-0">
      <span className="shrink-0">{icon}</span>
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "overflow-wrap-anywhere min-w-0 flex-1 [overflow-wrap:anywhere]",
          !hasValue && "text-muted-foreground",
        )}
        title={displayValue}
      >
        {displayValue}
      </span>
    </div>
  )
}

function getUserDisplayName(user: Pick<UserProfile, "name" | "nickname">) {
  const name = user.name.trim()
  const nickname = user.nickname.trim()

  return nickname || name || "未命名用户"
}

function getUserInitial(displayName: string) {
  return Array.from(displayName.trim())[0]?.toUpperCase() ?? "?"
}
