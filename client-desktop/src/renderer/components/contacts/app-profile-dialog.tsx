import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { Blocks, Camera, X } from "lucide-react"
import { toast } from "sonner"

import { AppAccessUserCombobox } from "@/components/contacts/app-access-user-combobox"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { prepareAppAvatar, type PreparedAppAvatar } from "@/lib/app-avatar-processing"
import type { ContactUser } from "@/lib/client-data-api"
import {
  updateClientApp,
  uploadClientAppAvatar,
  type ClientAppVisibility,
  type ClientOwnedApp,
} from "@/lib/client-api/apps"
import { cn } from "@/lib/utils"

function getVisibilityOptions(t: ReturnType<typeof useLocale>["t"]): Array<{
  label: string
  value: ClientAppVisibility
}> {
  return [
    { label: t("createApp.visibility.creator"), value: "creator" },
    { label: t("createApp.visibility.public"), value: "public" },
    { label: t("createApp.visibility.restricted"), value: "restricted" },
  ]
}

type AppProfileDialogProps = {
  app: ClientOwnedApp | null
  currentUserId: string
  onAppChange: (app: ClientOwnedApp) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  users: ContactUser[]
}

export function AppProfileDialog({
  app,
  currentUserId,
  onAppChange,
  onOpenChange,
  open,
  users,
}: AppProfileDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open && app && (
        <AppProfileDialogContent
          app={app}
          currentUserId={currentUserId}
          onAppChange={onAppChange}
          onOpenChange={onOpenChange}
          users={users}
        />
      )}
    </Dialog>
  )
}

function AppProfileDialogContent({
  app,
  currentUserId,
  onAppChange,
  onOpenChange,
  users,
}: Omit<AppProfileDialogProps, "app" | "open"> & { app: ClientOwnedApp }) {
  const { t } = useLocale()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const userComboboxPortal = React.useRef<HTMLDivElement>(null)
  const nameId = React.useId()
  const descriptionId = React.useId()
  const visibilityLabelId = React.useId()
  const grantableUsers = React.useMemo(
    () => users.filter((user) => user.id.toLowerCase() !== currentUserId.toLowerCase()),
    [currentUserId, users],
  )
  const [savedApp, setSavedApp] = React.useState(app)
  const [draftName, setDraftName] = React.useState(app.name)
  const [draftDescription, setDraftDescription] = React.useState(app.description)
  const [draftVisibility, setDraftVisibility] = React.useState<ClientAppVisibility>(app.visibility)
  const [selectedUsers, setSelectedUsers] = React.useState<ContactUser[]>(() =>
    findUsersById(grantableUsers, app.userIds),
  )
  const [pendingAvatar, setPendingAvatar] = React.useState<PreparedAppAvatar | null>(null)
  const [preparingAvatar, setPreparingAvatar] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const trimmedName = draftName.trim()
  const trimmedDescription = draftDescription.trim()
  const nameChanged = trimmedName !== savedApp.name
  const descriptionChanged = trimmedDescription !== savedApp.description
  const selectedUserIds = selectedUsers.map((user) => user.id)
  const draftAccessUserIds = draftVisibility === "restricted" ? selectedUserIds : []
  const savedAccessUserIds = savedApp.visibility === "restricted" ? savedApp.userIds : []
  const accessChanged =
    draftVisibility !== savedApp.visibility || !haveSameIds(draftAccessUserIds, savedAccessUserIds)
  const profileChanged = nameChanged || descriptionChanged || accessChanged
  const hasChanges = profileChanged || pendingAvatar !== null
  const busy = preparingAvatar || saving
  const canSave =
    hasChanges &&
    !busy &&
    trimmedName.length > 0 &&
    (draftVisibility !== "restricted" || selectedUserIds.length > 0)
  const previewAvatar = pendingAvatar?.previewUrl || savedApp.avatar
  const previewName = trimmedName || savedApp.name

  function applyUpdatedApp(updatedApp: ClientOwnedApp) {
    setSavedApp(updatedApp)
    onAppChange(updatedApp)
  }

  function syncDraftWithApp(updatedApp: ClientOwnedApp) {
    setDraftName(updatedApp.name)
    setDraftDescription(updatedApp.description)
    setDraftVisibility(updatedApp.visibility)
    setSelectedUsers(findUsersById(grantableUsers, updatedApp.userIds))
  }

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const sourceFile = event.target.files?.[0]

    event.target.value = ""
    if (!sourceFile || busy) {
      return
    }

    setPreparingAvatar(true)
    try {
      setPendingAvatar(await prepareAppAvatar(sourceFile))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("appProfile.avatarFailed"))
    } finally {
      setPreparingAvatar(false)
    }
  }

  async function handleSave() {
    if (!canSave) {
      return
    }

    setSaving(true)
    try {
      if (profileChanged) {
        const updatedApp = await updateClientApp(savedApp.id, {
          description: trimmedDescription,
          name: trimmedName,
          userIds: draftAccessUserIds,
          visibility: draftVisibility,
        })
        applyUpdatedApp(updatedApp)
        syncDraftWithApp(updatedApp)
      }

      if (pendingAvatar) {
        const updatedApp = await uploadClientAppAvatar(savedApp.id, pendingAvatar.file)
        setPendingAvatar(null)
        applyUpdatedApp(updatedApp)
        syncDraftWithApp(updatedApp)
      }

      toast.success(t("appProfile.saved"))
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("appProfile.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent
      className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-lg"
      onEscapeKeyDown={(event) => {
        if (busy) {
          event.preventDefault()
        }
      }}
      onPointerDownOutside={(event) => event.preventDefault()}
      showCloseButton={false}
    >
      <div className="flex items-start justify-between gap-4">
        <DialogHeader>
          <DialogTitle>{t("appProfile.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("appProfile.desc")}</DialogDescription>
        </DialogHeader>
        <Button
          aria-label={t("appProfile.close")}
          disabled={busy}
          onClick={() => onOpenChange(false)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>

      <div className="flex items-start gap-4">
        <input
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => void handleAvatarChange(event)}
          ref={fileInputRef}
          type="file"
        />
        <Button
          aria-label={t("appProfile.changeAvatar")}
          className="group/avatar-change relative h-auto overflow-hidden rounded-sm bg-muted p-0 hover:bg-background"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          type="button"
          variant="ghost"
        >
          <Avatar className="size-17 rounded-sm bg-muted after:rounded-sm">
            {previewAvatar && (
              <AvatarImage
                alt={previewName}
                className="rounded-sm object-cover"
                src={previewAvatar}
              />
            )}
            <AvatarFallback className="rounded-sm">
              <Blocks className="size-5" />
            </AvatarFallback>
          </Avatar>
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-foreground/40 text-background opacity-0 transition-opacity group-hover/avatar-change:opacity-100 group-focus-visible/avatar-change:opacity-100",
              preparingAvatar && "opacity-100",
            )}
          >
            {preparingAvatar ? <Spinner /> : <Camera className="size-5" />}
          </span>
        </Button>
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor={nameId}>{t("appProfile.name")}</FieldLabel>
          <Input
            disabled={busy}
            id={nameId}
            maxLength={120}
            onChange={(event) => setDraftName(event.target.value)}
            value={draftName}
          />
        </Field>
      </div>

      <div className="grid gap-5">
        <Field>
          <FieldLabel htmlFor={descriptionId}>{t("appProfile.description")}</FieldLabel>
          <Textarea
            className="min-h-28 resize-none"
            disabled={busy}
            id={descriptionId}
            maxLength={2000}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder={t("appProfile.descriptionPlaceholder")}
            value={draftDescription}
          />
        </Field>

        <div className="grid gap-2">
          <Label id={visibilityLabelId}>{t("appProfile.visibility")}</Label>
          <Select
            disabled={busy}
            onValueChange={(value) => setDraftVisibility(value as ClientAppVisibility)}
            value={draftVisibility}
          >
            <SelectTrigger aria-labelledby={visibilityLabelId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {getVisibilityOptions(t).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {draftVisibility === "restricted" && (
          <div className="grid gap-2">
            <Label>{t("appProfile.accessibleUsers")}</Label>
            <AppAccessUserCombobox
              disabled={busy}
              onValueChange={setSelectedUsers}
              portalContainer={userComboboxPortal}
              users={grantableUsers}
              value={selectedUsers}
            />
            <p className="text-xs text-muted-foreground">
              {t("appProfile.selectedUsers", { count: selectedUsers.length })}
            </p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          disabled={busy}
          onClick={() => onOpenChange(false)}
          type="button"
          variant="secondary"
        >
          {t("appProfile.closeBtn")}
        </Button>
        <Button disabled={!canSave} onClick={() => void handleSave()} type="button">
          {saving && <Spinner />}
          {t("appProfile.save")}
        </Button>
      </DialogFooter>
      <div className="absolute top-0 left-0 size-0" ref={userComboboxPortal} />
    </DialogContent>
  )
}

function findUsersById(users: ContactUser[], userIds: string[]) {
  const ids = new Set(userIds.map((userId) => userId.toLowerCase()))

  return users.filter((user) => ids.has(user.id.toLowerCase()))
}

function haveSameIds(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false
  }

  const rightIds = new Set(right.map((id) => id.toLowerCase()))

  return left.every((id) => rightIds.has(id.toLowerCase()))
}
