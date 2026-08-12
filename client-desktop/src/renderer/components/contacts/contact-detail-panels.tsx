import { useId, useState, type ReactNode } from "react"
import { useLocale } from "@/components/locale-provider"
import { Bot, Loader2Icon, Mail, Phone, UserPen, UserRound, UsersRound } from "lucide-react"
import { toast } from "sonner"

import { GroupAvatar } from "@/components/group-avatar"
import { UserProfilePopoverLink, type UserProfile } from "@/components/user-profile-popover"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ContactApp, ContactGroup, ContactUser } from "@/lib/client-data-api"
import { formatContactPhone } from "@/lib/contact-format"
import { cn } from "@/lib/utils"

const CONTACT_DETAIL_PANEL_CLASS = "mt-30 w-full min-w-0 max-w-sm overflow-hidden"

export function AppDetailPanel({
  app,
  developer,
  editingProfile = false,
  onDelete,
  onEditProfile,
  onStartConversation,
  onViewAccessInfo,
  startingConversation,
  viewingAccessInfo = false,
}: {
  app: ContactApp
  developer?: UserProfile
  editingProfile?: boolean
  onDelete?: () => Promise<void>
  onEditProfile?: () => void
  onStartConversation: () => void
  onViewAccessInfo?: () => void
  startingConversation: boolean
  viewingAccessInfo?: boolean
}) {
  const { t } = useLocale()
  const deleteConfirmationId = useId()
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!onDelete || deleting || deleteConfirmation !== app.name) {
      return
    }
    setDeleting(true)
    try {
      await onDelete()
      toast.success(t("app.deleted"))
      setDeleteOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.deleteFailed"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={CONTACT_DETAIL_PANEL_CLASS} data-testid="contact-detail-panel">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
          <Avatar
            className="size-20 rounded-sm bg-muted after:rounded-sm"
            data-testid="contact-detail-avatar"
          >
            {app.avatar && <AvatarImage alt={app.name} className="rounded-sm" src={app.avatar} />}
            <AvatarFallback className="rounded-sm text-xl">
              <Bot className="size-7" />
            </AvatarFallback>
          </Avatar>
          <div className="max-w-full min-w-0">
            <div className="truncate text-base font-medium">{app.name}</div>
            {app.description && (
              <div className="mt-1 line-clamp-2 text-sm break-words text-muted-foreground">
                {app.description}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-1 text-sm">
          <ContactDetailRow
            icon={<Bot className="size-4 text-muted-foreground" />}
            label={t("app.type")}
            value={t("app.typeValue")}
          />
          {developer && (
            <ContactDetailRow
              icon={<UserRound className="size-4 text-muted-foreground" />}
              label={t("app.developer")}
              value={<UserProfilePopoverLink profile={developer} />}
            />
          )}
          <ContactDetailRow
            icon={<UserRound className="size-4 text-muted-foreground" />}
            label={t("app.status")}
            value={app.online ? t("app.online") : t("app.offline")}
          />
        </div>
        <div className="grid gap-2">
          <Button
            className="w-full"
            disabled={startingConversation}
            onClick={onStartConversation}
            type="button"
          >
            {startingConversation && <Loader2Icon aria-hidden="true" className="animate-spin" />}
            {t("app.sendMessage")}
          </Button>
          {onViewAccessInfo && onEditProfile && (
            <div className="grid gap-2">
              <Button
                className="w-full"
                disabled={editingProfile}
                onClick={onEditProfile}
                type="button"
                variant="secondary"
              >
                {editingProfile ? (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                ) : null}
                {t("app.editProfile")}
              </Button>
              <Button
                className="w-full"
                disabled={viewingAccessInfo}
                onClick={onViewAccessInfo}
                type="button"
                variant="secondary"
              >
                {viewingAccessInfo ? (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                ) : null}
                {t("app.devGuide")}
              </Button>
              {onDelete && (
                <Button
                  className="w-full"
                  disabled={deleting}
                  onClick={() => setDeleteOpen(true)}
                  type="button"
                  variant="destructive"
                >
                  {t("app.delete")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (deleting) return
          setDeleteOpen(open)
          if (!open) setDeleteConfirmation("")
        }}
        open={deleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("app.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={deleteConfirmationId}>
              {t("app.deleteConfirmInput", { name: app.name })}
            </Label>
            <Input
              autoFocus
              disabled={deleting}
              id={deleteConfirmationId}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              value={deleteConfirmation}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("app.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || deleteConfirmation !== app.name}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
              variant="destructive"
            >
              {deleting && <Loader2Icon aria-hidden="true" className="animate-spin" />}
              {t("app.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function GroupDetailPanel({
  group,
  onStartConversation,
  startingConversation,
}: {
  group: ContactGroup
  onStartConversation: () => void
  startingConversation: boolean
}) {
  const { t } = useLocale()
  return (
    <div className={CONTACT_DETAIL_PANEL_CLASS} data-testid="contact-detail-panel">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
          <GroupAvatar
            avatar={group.avatar}
            className="size-20"
            members={group.avatarMembers}
            name={group.name}
          />
          <div className="max-w-full min-w-0">
            <div className="truncate text-base font-medium">{group.name}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t("app.memberCountGroup", { count: group.memberCount })}
            </div>
          </div>
        </div>

        <div className="grid gap-1 text-sm">
          <ContactDetailRow
            icon={<UsersRound className="size-4 text-muted-foreground" />}
            label={t("app.type")}
            value={t("app.groupType")}
          />
          <ContactDetailRow
            icon={<UserRound className="size-4 text-muted-foreground" />}
            label={t("app.status")}
            value={group.joined ? t("app.joined") : t("app.notJoined")}
          />
        </div>
        <Button
          className="w-full"
          disabled={startingConversation}
          onClick={onStartConversation}
          type="button"
        >
          {startingConversation && <Loader2Icon aria-hidden="true" className="animate-spin" />}
          {group.joined ? t("app.sendMessage") : t("app.joinGroup")}
        </Button>
      </div>
    </div>
  )
}

export function ContactDetailPanel({
  canStartConversation,
  contact,
  friendAction,
  onStartConversation,
  startingConversation,
}: {
  canStartConversation: boolean
  contact: ContactUser
  friendAction?: ContactFriendAction
  onStartConversation: () => void
  startingConversation: boolean
}) {
  const { t } = useLocale()
  const displayName = getContactDisplayName(contact)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className={CONTACT_DETAIL_PANEL_CLASS} data-testid="contact-detail-panel">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-col items-center text-center">
          <Avatar
            className="size-20 rounded-sm bg-muted after:rounded-sm"
            data-testid="contact-detail-avatar"
          >
            {contact.avatar && (
              <AvatarImage alt={displayName} className="rounded-sm" src={contact.avatar} />
            )}
            <AvatarFallback className="rounded-sm text-xl">
              {getContactInitial(displayName)}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="grid gap-1 text-sm">
          <ContactDetailRow
            icon={<UserRound className="size-4 text-muted-foreground" />}
            label={t("app.contactName")}
            value={contact.name}
          />
          <ContactDetailRow
            icon={<UserPen className="size-4 text-muted-foreground" />}
            label={t("app.contactNickname")}
            value={contact.nickname}
          />
          <ContactDetailRow
            icon={<Mail className="size-4 text-muted-foreground" />}
            label={t("app.contactEmail")}
            value={contact.email}
          />
          <ContactDetailRow
            icon={<Phone className="size-4 text-muted-foreground" />}
            label={t("app.contactPhone")}
            value={contact.phone ? formatContactPhone(contact.phone) : ""}
          />
        </div>
        <div className="grid gap-2">
          {canStartConversation && (
            <Button
              className="w-full"
              disabled={startingConversation}
              onClick={onStartConversation}
              type="button"
            >
              {startingConversation && <Loader2Icon aria-hidden="true" className="animate-spin" />}
              {t("app.sendMessage")}
            </Button>
          )}
          {friendAction && friendAction.kind !== "delete" && (
            <Button
              className="w-full"
              disabled={friendAction.pending || friendAction.disabled}
              onClick={() => void friendAction.onAction()}
              type="button"
              variant={friendAction.kind === "accept" ? "default" : "secondary"}
            >
              {friendAction.pending && <Loader2Icon aria-hidden="true" className="animate-spin" />}
              {t(friendAction.labelKey)}
            </Button>
          )}
          {friendAction?.secondaryAction && (
            <Button
              className="w-full"
              disabled={
                friendAction.secondaryAction.pending || friendAction.secondaryAction.disabled
              }
              onClick={() => void friendAction.secondaryAction?.onAction()}
              type="button"
              variant="outline"
            >
              {friendAction.secondaryAction.pending && (
                <Loader2Icon aria-hidden="true" className="animate-spin" />
              )}
              {t(friendAction.secondaryAction.labelKey)}
            </Button>
          )}
          {friendAction?.kind === "delete" && (
            <>
              <Button
                className="w-full"
                disabled={friendAction.pending}
                onClick={() => setDeleteOpen(true)}
                type="button"
                variant="destructive"
              >
                {friendAction.pending && (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                )}
                {t(friendAction.labelKey)}
              </Button>
              <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("friend.deleteConfirm")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("friend.deleteDescription", { name: displayName })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={friendAction.pending}>
                      {t("friend.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={friendAction.pending}
                      onClick={(event) => {
                        event.preventDefault()
                        void friendAction
                          .onAction()
                          .then((succeeded) => {
                            if (succeeded) setDeleteOpen(false)
                          })
                          .catch(() => undefined)
                      }}
                      variant="destructive"
                    >
                      {friendAction.pending && (
                        <Loader2Icon aria-hidden="true" className="animate-spin" />
                      )}
                      {t(friendAction.labelKey)}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export type ContactFriendActionControl = {
  disabled?: boolean
  kind: "accept" | "add" | "cancel" | "delete" | "reject" | "waiting"
  labelKey:
    | "friend.accept"
    | "friend.add"
    | "friend.cancelRequest"
    | "friend.delete"
    | "friend.reject"
    | "friend.waiting"
  onAction: () => Promise<boolean>
  pending: boolean
}

export type ContactFriendAction = ContactFriendActionControl & {
  secondaryAction?: ContactFriendActionControl
}

export function ContactEmptyState() {
  const { t } = useLocale()
  return (
    <div
      className="flex flex-1 items-center justify-center self-stretch text-sm text-muted-foreground"
      data-testid="contact-empty-state"
    >
      {t("app.emptyContactDetail")}
    </div>
  )
}

function ContactDetailRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
}) {
  const { t } = useLocale()
  const hasValue = typeof value !== "string" || Boolean(value.trim())
  const displayValue = hasValue ? value : t("app.notSet")

  return (
    <div className="flex min-w-0 items-center gap-3 border-b py-2 last:border-b-0">
      <span className="shrink-0">{icon}</span>
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", !hasValue && "text-muted-foreground")}>
        {displayValue}
      </span>
    </div>
  )
}

function getContactDisplayName(contact: { name: string; nickname: string }) {
  return contact.nickname || contact.name
}

function getContactInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
