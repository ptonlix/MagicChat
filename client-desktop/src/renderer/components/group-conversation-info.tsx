import { useEffect, useId, useRef, useState } from "react"

import { Camera, Check, Globe2, Lock, LogOut, MinusSquare, Pencil, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import type { ClientConversationMember } from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import { CustomAvatarPicker, type CroppedAvatar } from "@/components/custom-avatar-picker"
import { GroupAvatar } from "@/components/group-avatar"
import { GroupConversationProjects } from "@/components/group-conversation-projects"
import { useLocale } from "@/components/locale-provider"
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
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { UserProfilePopover } from "@/components/user-profile-popover"
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type GroupConversationInfoProps = {
  conversationId: string
}

export function GroupConversationInfo({ conversationId }: GroupConversationInfoProps) {
  const {
    dissolveGroupConversation,
    getConversation,
    leaveGroupConversation,
    me,
    projects,
    refreshConversations,
    refreshProjects,
    removeGroupConversationMember,
    setGroupConversationPrivate,
    setGroupConversationPublic,
    updateGroupConversationAnnouncement,
    updateGroupConversationName,
    updateGroupConversationAvatar,
  } = useClientData()
  const { t } = useLocale()
  const conversation = getConversation(conversationId)
  const [announcementClearConfirmOpen, setAnnouncementClearConfirmOpen] = useState(false)
  const [announcementEditorOpen, setAnnouncementEditorOpen] = useState(false)
  const [announcementDraft, setAnnouncementDraft] = useState("")
  const [announcementSaving, setAnnouncementSaving] = useState(false)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [dissolveConfirmOpen, setDissolveConfirmOpen] = useState(false)
  const [dissolveSaving, setDissolveSaving] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [leaveSaving, setLeaveSaving] = useState(false)
  const [memberRemovalSaving, setMemberRemovalSaving] = useState(false)
  const [memberRemovalTarget, setMemberRemovalTarget] = useState<ClientConversationMember | null>(
    null,
  )
  const [nameSaving, setNameSaving] = useState(false)
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const [visibilityTarget, setVisibilityTarget] = useState<"private" | "public" | null>(null)
  const [draftAvatarOverride, setDraftAvatarOverride] = useState<{
    avatar: string
    baseAvatar: string
    conversationId: string
  } | null>(null)

  if (!conversation) {
    return (
      <>
        <SheetHeader className="border-b">
          <SheetTitle>{t("group.info.title")}</SheetTitle>
          <SheetDescription>{t("group.info.subtitle")}</SheetDescription>
        </SheetHeader>
        <div className="px-4 py-6 text-sm text-muted-foreground">{t("group.info.unavailable")}</div>
      </>
    )
  }

  const activeConversation = conversation
  const members = [...(activeConversation.members ?? [])].sort(compareConversationMembers)
  const currentMember = members.find((member) => member.id === me.id)
  const canChangeAvatar = canManageGroupAvatar(currentMember?.role)
  const canManageMembers = canManageGroupMembers(currentMember?.role)
  const canManageProjects = canManageGroupProjects(currentMember?.role)
  const canChangeName = canManageGroupName(currentMember?.role)
  const canChangeAnnouncement = canManageGroupAnnouncement(currentMember?.role)
  const canLeaveGroup = Boolean(currentMember && currentMember.role !== "owner")
  const canDissolveGroup = currentMember?.role === "owner"
  const canChangeVisibility = currentMember?.role === "owner"
  const isPublicGroup = activeConversation.visibility === "public"
  const conversationName = activeConversation.name
  const conversationAvatar = activeConversation.avatar
  const normalizedAnnouncementDraft = announcementDraft.trim()
  const announcementDraftLength = Array.from(normalizedAnnouncementDraft).length
  const announcementDraftTooLong = announcementDraftLength > 200
  const draftAvatar =
    draftAvatarOverride?.conversationId === activeConversation.id &&
    draftAvatarOverride.baseAvatar === conversationAvatar
      ? draftAvatarOverride.avatar
      : conversationAvatar

  async function handleAvatarSave(avatar: CroppedAvatar) {
    if (!canChangeAvatar || avatarSaving) {
      return
    }

    setAvatarSaving(true)
    try {
      const updatedConversation = await updateGroupConversationAvatar(
        activeConversation.id,
        avatar.file,
      )
      setDraftAvatarOverride({
        avatar: updatedConversation.avatar,
        baseAvatar: updatedConversation.avatar,
        conversationId: updatedConversation.id,
      })
      setAvatarPickerOpen(false)
      toast.success(t("group.avatarSaved"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("group.avatarUploadFailed")))
    } finally {
      setAvatarSaving(false)
    }
  }

  async function handleNameSave(name: string) {
    if (!canChangeName || nameSaving) {
      return
    }

    setNameSaving(true)
    try {
      await updateGroupConversationName(activeConversation.id, name)
      toast.success(t("group.nameSaved"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("group.nameUpdateFailed")))
      throw error
    } finally {
      setNameSaving(false)
    }
  }

  function openAnnouncementEditor() {
    if (!canChangeAnnouncement || announcementSaving) return
    setAnnouncementDraft(activeConversation.announcement ?? "")
    setAnnouncementEditorOpen(true)
  }

  async function handleAnnouncementSave(announcement: string) {
    if (!canChangeAnnouncement || announcementSaving) return

    setAnnouncementSaving(true)
    try {
      await updateGroupConversationAnnouncement(activeConversation.id, announcement)
      setAnnouncementClearConfirmOpen(false)
      setAnnouncementEditorOpen(false)
      toast.success(
        announcement.trim() ? t("group.announcementSaved") : t("group.announcementCleared"),
      )
    } catch (error) {
      toast.error(getErrorMessage(error, t("group.announcementUpdateFailed")))
    } finally {
      setAnnouncementSaving(false)
    }
  }

  async function handleLeaveGroup() {
    if (!canLeaveGroup || leaveSaving) {
      return
    }

    setLeaveSaving(true)
    try {
      await leaveGroupConversation(activeConversation.id)
      setLeaveConfirmOpen(false)
      toast.success(t("group.left"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("group.leaveFailed")))
    } finally {
      setLeaveSaving(false)
    }
  }

  async function handleDissolveGroup() {
    if (!canDissolveGroup || dissolveSaving) {
      return
    }

    setDissolveSaving(true)
    try {
      await dissolveGroupConversation(activeConversation.id)
      setDissolveConfirmOpen(false)
      toast.success(t("group.dissolved"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("group.dissolveFailed")))
    } finally {
      setDissolveSaving(false)
    }
  }

  async function handleRemoveMember() {
    if (
      !canManageMembers ||
      !memberRemovalTarget ||
      memberRemovalSaving ||
      (memberRemovalTarget.type === "user" && memberRemovalTarget.id === me.id) ||
      memberRemovalTarget.role === "owner"
    ) {
      return
    }

    const target = memberRemovalTarget
    setMemberRemovalSaving(true)
    try {
      await removeGroupConversationMember(activeConversation.id, target.id, target.type)
      setMemberRemovalTarget(null)
      toast.success(t("group.memberRemoved"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("group.memberRemoveFailed")))
    } finally {
      setMemberRemovalSaving(false)
    }
  }

  async function handleVisibilityChange(target: "private" | "public") {
    if (!canChangeVisibility || visibilitySaving) {
      return
    }

    setVisibilitySaving(true)
    try {
      if (target === "public") {
        await setGroupConversationPublic(activeConversation.id)
        toast.success(t("group.madePublic"))
      } else {
        await setGroupConversationPrivate(activeConversation.id)
        toast.success(t("group.madePrivate"))
      }
      setVisibilityTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t("group.visibilityUpdateFailed")))
    } finally {
      setVisibilitySaving(false)
    }
  }

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("group.info.title")}</SheetTitle>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          <div className="flex justify-center">
            <GroupConversationAvatarControl
              avatar={draftAvatar}
              canChangeAvatar={canChangeAvatar}
              members={members}
              name={conversationName}
              onClick={() => setAvatarPickerOpen(true)}
            />
          </div>

          <GroupConversationNameControl
            canChangeName={canChangeName}
            name={conversationName}
            onSave={handleNameSave}
            saving={nameSaving}
          />

          <GroupConversationAnnouncementControl
            announcement={activeConversation.announcement ?? ""}
            canChange={canChangeAnnouncement}
            onEdit={openAnnouncementEditor}
          />

          <GroupConversationProjects
            availableProjects={projects}
            canManage={canManageProjects}
            conversationId={activeConversation.id}
            key={activeConversation.id}
            linkedProjects={activeConversation.projects ?? []}
            onConversationsChanged={refreshConversations}
            onProjectsChanged={refreshProjects}
          />

          <div className="grid gap-2">
            <Label>{t("group.membersLabel", { count: activeConversation.memberCount })}</Label>
            <div className="grid gap-1">
              {members.map((member) => (
                <GroupMemberItem
                  canRemove={
                    canManageMembers &&
                    (member.type !== "user" || member.id !== me.id) &&
                    member.role !== "owner"
                  }
                  key={`${member.type}:${member.id}`}
                  member={member}
                  onRemove={() => setMemberRemovalTarget(member)}
                />
              ))}
              {members.length === 0 && (
                <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("group.noMembers")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Dialog
        open={avatarPickerOpen}
        onOpenChange={(open) => {
          if (!avatarSaving) {
            setAvatarPickerOpen(open)
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex w-[calc(100vw-2rem)] max-w-2xl flex-col gap-4 rounded-md border bg-background p-5 text-foreground shadow-lg ring-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-base font-medium">
                {t("group.editAvatar.title")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("group.editAvatar.desc")}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                aria-label={t("group.editAvatar.close")}
                disabled={avatarSaving}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X className="size-4" />
              </Button>
            </DialogClose>
          </div>
          <CustomAvatarPicker onSave={handleAvatarSave} saving={avatarSaving} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={announcementEditorOpen}
        onOpenChange={(open) => {
          if (!announcementSaving) setAnnouncementEditorOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t("group.editAnnouncement.title")}</DialogTitle>
          <DialogDescription>{t("group.editAnnouncement.desc")}</DialogDescription>
          <div className="grid gap-2">
            <Label htmlFor="group-announcement-editor">{t("group.announcement")}</Label>
            <Textarea
              aria-invalid={announcementDraftTooLong}
              className="min-h-32 resize-y"
              disabled={announcementSaving}
              id="group-announcement-editor"
              onChange={(event) => setAnnouncementDraft(event.target.value)}
              placeholder={t("group.announcement.placeholder")}
              value={announcementDraft}
            />
            <div
              className={
                announcementDraftTooLong
                  ? "text-right text-xs text-destructive"
                  : "text-right text-xs text-muted-foreground"
              }
            >
              {announcementDraftLength}/200
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              disabled={announcementSaving || !activeConversation.announcement}
              onClick={() => setAnnouncementClearConfirmOpen(true)}
              type="button"
              variant="outline"
            >
              {t("group.announcement.clear")}
            </Button>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button disabled={announcementSaving} type="button" variant="outline">
                  {t("group.cancel")}
                </Button>
              </DialogClose>
              <Button
                disabled={
                  announcementSaving ||
                  announcementDraftTooLong ||
                  normalizedAnnouncementDraft === (activeConversation.announcement ?? "").trim()
                }
                onClick={() => void handleAnnouncementSave(normalizedAnnouncementDraft)}
                type="button"
              >
                {t("group.save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={announcementClearConfirmOpen}
        onOpenChange={(open) => {
          if (!announcementSaving) setAnnouncementClearConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("group.clearAnnouncement.confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("group.clearAnnouncement.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={announcementSaving}>{t("group.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                announcementSaving || !canChangeAnnouncement || !activeConversation.announcement
              }
              onClick={(event) => {
                event.preventDefault()
                void handleAnnouncementSave("")
              }}
              variant="destructive"
            >
              {announcementSaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              {t("group.announcement.clear")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SheetFooter className="border-t">
        {canChangeVisibility && (
          <Button
            disabled={visibilitySaving}
            onClick={() => setVisibilityTarget(isPublicGroup ? "private" : "public")}
            type="button"
            variant="outline"
          >
            {isPublicGroup ? (
              <Lock aria-hidden="true" className="size-4" />
            ) : (
              <Globe2 aria-hidden="true" className="size-4" />
            )}
            {isPublicGroup ? t("group.visibility.private") : t("group.visibility.public")}
          </Button>
        )}
        {canLeaveGroup && (
          <Button
            disabled={leaveSaving}
            onClick={() => setLeaveConfirmOpen(true)}
            type="button"
            variant="destructive"
          >
            <LogOut aria-hidden="true" className="size-4" />
            {t("group.leave")}
          </Button>
        )}
        {canDissolveGroup && (
          <Button
            disabled={dissolveSaving}
            onClick={() => setDissolveConfirmOpen(true)}
            type="button"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            {t("group.dissolve")}
          </Button>
        )}
      </SheetFooter>
      <AlertDialog
        open={leaveConfirmOpen}
        onOpenChange={(open) => {
          if (!leaveSaving) {
            setLeaveConfirmOpen(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("group.leave.confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("group.leave.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaveSaving}>{t("group.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={leaveSaving || !canLeaveGroup}
              onClick={(event) => {
                event.preventDefault()
                void handleLeaveGroup()
              }}
              variant="destructive"
            >
              {leaveSaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              {t("group.leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={dissolveConfirmOpen}
        onOpenChange={(open) => {
          if (!dissolveSaving) {
            setDissolveConfirmOpen(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("group.dissolve.confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("group.dissolve.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dissolveSaving}>{t("group.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={dissolveSaving || !canDissolveGroup}
              onClick={(event) => {
                event.preventDefault()
                void handleDissolveGroup()
              }}
              variant="destructive"
            >
              {dissolveSaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              {t("group.dissolve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={visibilityTarget !== null}
        onOpenChange={(open) => {
          if (!visibilitySaving && !open) {
            setVisibilityTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {visibilityTarget === "private"
                ? t("group.visibility.private")
                : t("group.visibility.public")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {visibilityTarget === "private"
                ? t("group.visibility.private.desc")
                : t("group.visibility.public.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={visibilitySaving}>{t("group.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={visibilitySaving}
              onClick={(event) => {
                event.preventDefault()
                if (visibilityTarget) {
                  void handleVisibilityChange(visibilityTarget)
                }
              }}
            >
              {visibilitySaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              {t("group.visibility.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={memberRemovalTarget !== null}
        onOpenChange={(open) => {
          if (!memberRemovalSaving && !open) {
            setMemberRemovalTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("group.removeMember.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("group.removeMember.desc", {
                name: memberRemovalTarget
                  ? getMemberDisplayName(memberRemovalTarget)
                  : t("group.removeMember.member"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={memberRemovalSaving}>
              {t("group.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={memberRemovalSaving}
              onClick={(event) => {
                event.preventDefault()
                void handleRemoveMember()
              }}
              variant="destructive"
            >
              {memberRemovalSaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              {t("group.removeMember.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function GroupConversationNameControl({
  canChangeName,
  name,
  onSave,
  saving,
}: {
  canChangeName: boolean
  name: string
  onSave: (name: string) => Promise<void> | void
  saving: boolean
}) {
  const { t } = useLocale()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const trimmedDraftName = draftName.trim()
  const saveDisabled = trimmedDraftName === "" || trimmedDraftName === name.trim()

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function startEditing() {
    if (saving) {
      return
    }

    setDraftName(name)
    setEditing(true)
  }

  function cancelEditing() {
    if (saving) {
      return
    }

    setDraftName(name)
    setEditing(false)
  }

  async function saveName() {
    if (saveDisabled || saving) {
      return
    }

    try {
      await onSave(trimmedDraftName)
      setEditing(false)
    } catch {
      return
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{t("group.nameLabel")}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          disabled={!editing || saving}
          id={inputId}
          maxLength={120}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void saveName()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              cancelEditing()
            }
          }}
          ref={inputRef}
          value={editing ? draftName : name}
        />
        {canChangeName && editing ? (
          <>
            <Button
              aria-label={t("group.name.aria.save")}
              disabled={saveDisabled || saving}
              onClick={() => void saveName()}
              size="icon-sm"
              type="button"
            >
              <Check className="size-4" />
            </Button>
            <Button
              aria-label={t("group.name.aria.cancel")}
              disabled={saving}
              onClick={cancelEditing}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <X className="size-4" />
            </Button>
          </>
        ) : canChangeName ? (
          <Button
            aria-label={t("group.name.aria.edit")}
            disabled={saving}
            onClick={startEditing}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <Pencil className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function GroupConversationAnnouncementControl({
  announcement,
  canChange,
  onEdit,
}: {
  announcement: string
  canChange: boolean
  onEdit: () => void
}) {
  const { t } = useLocale()
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{t("group.announcement")}</Label>
        {canChange && (
          <Button
            aria-label={t("group.announcement.aria.edit")}
            onClick={onEdit}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Pencil className="size-4" />
          </Button>
        )}
      </div>
      <div className="min-h-16 rounded-md border bg-muted/30 px-3 py-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">
        {announcement || t("group.announcement.empty")}
      </div>
    </div>
  )
}

function GroupConversationAvatarControl({
  avatar,
  canChangeAvatar,
  members,
  name,
  onClick,
}: {
  avatar: string
  canChangeAvatar: boolean
  members: ClientConversationMember[]
  name: string
  onClick: () => void
}) {
  const { t } = useLocale()
  const avatarNode = (
    <GroupAvatar avatar={avatar} className="size-20" members={members} name={name} />
  )

  if (!canChangeAvatar) {
    return avatarNode
  }

  return (
    <Button
      aria-haspopup="dialog"
      aria-label={t("group.avatar.aria.change")}
      className="group/group-avatar-change relative h-auto overflow-hidden rounded-sm bg-muted p-0 hover:bg-background"
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      {avatarNode}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-foreground/40 text-background opacity-0 transition-opacity group-hover/group-avatar-change:opacity-100 group-focus-visible/group-avatar-change:opacity-100"
      >
        <Camera className="size-5" />
      </span>
    </Button>
  )
}

function GroupMemberItem({
  canRemove,
  member,
  onRemove,
}: {
  canRemove: boolean
  member: ClientConversationMember
  onRemove: () => void
}) {
  const { t } = useLocale()
  const displayName = getMemberDisplayName(member)
  const content = <GroupMemberItemContent member={member} />

  return (
    <div className="group/member flex min-w-0 items-center gap-1 rounded-md hover:bg-muted">
      {member.type === "user" ? (
        <UserProfilePopover
          fallbackProfile={member}
          triggerClassName="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-sm"
          userId={member.id}
        >
          {content}
        </UserProfilePopover>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-sm">{content}</div>
      )}
      {canRemove && (
        <Button
          aria-label={t("group.member.removeAria", { name: displayName })}
          className="pointer-events-none mr-1 opacity-0 transition-opacity group-hover/member:pointer-events-auto group-hover/member:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove()
          }}
          size="icon-sm"
          title={t("group.removeMember.title")}
          type="button"
          variant="ghost"
        >
          <MinusSquare className="size-4" />
        </Button>
      )}
    </div>
  )
}

function GroupMemberItemContent({ member }: { member: ClientConversationMember }) {
  const { t } = useLocale()
  const displayName = getMemberDisplayName(member)

  return (
    <>
      <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
        {member.avatar && (
          <AvatarImage alt={displayName} className="rounded-sm" src={member.avatar} />
        )}
        <AvatarFallback className="rounded-sm">{getInitial(displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate">{displayName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {getMemberRoleLabel(member, t)}
        </div>
      </div>
    </>
  )
}

function getMemberDisplayName(member: Pick<ClientConversationMember, "name" | "nickname">) {
  return member.nickname.trim() || member.name.trim()
}

function getMemberRoleLabel(
  member: ClientConversationMember,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (member.type === "app") {
    return t("group.role.app")
  }
  if (member.role === "owner") {
    return t("group.role.owner")
  }
  if (member.role === "admin") {
    return t("group.role.admin")
  }

  return t("group.role.member")
}

function compareConversationMembers(
  left: ClientConversationMember,
  right: ClientConversationMember,
) {
  return getConversationMemberOrder(left) - getConversationMemberOrder(right)
}

function getConversationMemberOrder(member: ClientConversationMember) {
  if (member.role === "owner") return 0
  if (member.role === "admin") return 1
  if (member.type === "app") return 2
  return 3
}

function canManageGroupAvatar(role: ClientConversationMember["role"] | undefined) {
  return role === "owner" || role === "admin"
}

function canManageGroupName(role: ClientConversationMember["role"] | undefined) {
  return role === "owner" || role === "admin" || role === "member"
}

function canManageGroupAnnouncement(role: ClientConversationMember["role"] | undefined) {
  return role === "owner" || role === "admin"
}

function canManageGroupMembers(role: ClientConversationMember["role"] | undefined) {
  return role === "owner" || role === "admin"
}

function canManageGroupProjects(role: ClientConversationMember["role"] | undefined) {
  return role === "owner" || role === "admin"
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
