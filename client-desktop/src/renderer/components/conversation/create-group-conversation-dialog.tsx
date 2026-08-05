import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { Loader2Icon, Search } from "lucide-react"
import { toast } from "sonner"

import type { ContactApp, ContactUser } from "@/lib/client-data-api"
import { sortContactsByDisplayName } from "@/lib/contact-sort"
import { cn } from "@/lib/utils"
import { SelectionListAvatar } from "@/components/selection-list-avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function CreateGroupConversationDialog({
  apps,
  contacts,
  currentUserId,
  onCreate,
  onOpenChange,
  open,
}: {
  apps: ContactApp[]
  contacts: ContactUser[]
  currentUserId: string
  onCreate: (name: string, memberIds: string[], appIds: string[]) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{t("createGroup.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("createGroup.desc")}</DialogDescription>
        </DialogHeader>
        <CreateGroupConversationForm
          apps={apps}
          contacts={contacts}
          currentUserId={currentUserId}
          onCreate={onCreate}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateGroupConversationForm({
  apps,
  contacts,
  currentUserId,
  onCreate,
  onOpenChange,
}: {
  apps: ContactApp[]
  contacts: ContactUser[]
  currentUserId: string
  onCreate: (name: string, memberIds: string[], appIds: string[]) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useLocale()
  const [creating, setCreating] = React.useState(false)
  const [keyword, setKeyword] = React.useState("")
  const [name, setName] = React.useState(t("createGroup.defaultName"))
  const [tab, setTab] = React.useState<"users" | "apps">("users")
  const [selectedCandidateKeys, setSelectedCandidateKeys] = React.useState<Set<string>>(
    () => new Set(),
  )
  const trimmedName = name.trim()
  const canCreate = Boolean(trimmedName) && !creating
  const filteredContacts = React.useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    return sortContactsByDisplayName(
      contacts.filter((contact) => {
        if (contact.id === currentUserId) {
          return false
        }
        if (!normalizedKeyword) {
          return true
        }

        return [contact.email, contact.name, contact.nickname, contact.phone].some((value) =>
          value.toLowerCase().includes(normalizedKeyword),
        )
      }),
    )
  }, [contacts, currentUserId, keyword])
  const filteredApps = React.useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    if (!normalizedKeyword) {
      return apps
    }

    return apps.filter((app) =>
      [app.name, app.description].some((value) => value.toLowerCase().includes(normalizedKeyword)),
    )
  }, [apps, keyword])
  const visibleCandidates: CreateGroupCandidate[] = tab === "apps" ? filteredApps : filteredContacts

  const toggleCandidate = React.useCallback(
    (candidate: CreateGroupCandidate, checked: boolean | string) => {
      const key = createGroupCandidateKey(candidate)
      setSelectedCandidateKeys((currentKeys) => {
        const nextChecked = Boolean(checked)
        const currentChecked = currentKeys.has(key)

        if (currentChecked === nextChecked) {
          return currentKeys
        }

        const nextKeys = new Set(currentKeys)

        if (nextChecked) {
          nextKeys.add(key)
        } else {
          nextKeys.delete(key)
        }

        return nextKeys
      })
    },
    [],
  )

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canCreate) {
      return
    }

    setCreating(true)

    try {
      const memberIds = contacts
        .filter((contact) => selectedCandidateKeys.has(createGroupCandidateKey(contact)))
        .map((contact) => contact.id)
      const appIds = apps
        .filter((app) => selectedCandidateKeys.has(createGroupCandidateKey(app)))
        .map((app) => app.id)

      await onCreate(trimmedName, memberIds, appIds)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("createGroup.failed"))
    } finally {
      setCreating(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="create-group-name">{t("createGroup.name")}</Label>
        <Input
          id="create-group-name"
          onChange={(event) => setName(event.target.value)}
          placeholder={t("createGroup.namePlaceholder")}
          value={name}
        />
      </div>
      <Tabs
        onValueChange={(value) => {
          setKeyword("")
          setTab(value === "apps" ? "apps" : "users")
        }}
        value={tab}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger disabled={creating} value="users">
            {t("createGroup.members")}
          </TabsTrigger>
          <TabsTrigger disabled={creating} value="apps">
            {t("createGroup.apps")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-2">
        <Label htmlFor="create-group-member-search">
          {tab === "apps" ? t("createGroup.pickApps") : t("createGroup.pickMembers")}
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            id="create-group-member-search"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={
              tab === "apps" ? t("createGroup.searchApps") : t("createGroup.searchContacts")
            }
            type="search"
            value={keyword}
          />
        </div>
      </div>
      <CreateGroupCandidateList
        candidates={visibleCandidates}
        onToggleCandidate={toggleCandidate}
        selectedCandidateKeys={selectedCandidateKeys}
        tab={tab}
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button disabled={creating} type="button" variant="outline">
            {t("createGroup.cancel")}
          </Button>
        </DialogClose>
        <Button disabled={!canCreate} type="submit">
          {creating && <Loader2Icon aria-hidden="true" className="animate-spin" />}
          {t("createGroup.create")}
        </Button>
      </DialogFooter>
    </form>
  )
}

const CreateGroupCandidateList = React.memo(function CreateGroupCandidateList({
  candidates,
  onToggleCandidate,
  selectedCandidateKeys,
  tab,
}: {
  candidates: CreateGroupCandidate[]
  onToggleCandidate: (candidate: CreateGroupCandidate, checked: boolean | string) => void
  selectedCandidateKeys: Set<string>
  tab: "users" | "apps"
}) {
  const { t } = useLocale()
  return (
    <div className="h-64 overflow-y-auto rounded-md border">
      <ItemGroup
        aria-label={tab === "apps" ? t("createGroup.appsAria") : t("createGroup.membersAria")}
        className="gap-1 p-2 has-data-[size=sm]:gap-1"
        role="group"
      >
        {candidates.map((candidate) => {
          const key = createGroupCandidateKey(candidate)

          return (
            <CreateGroupMemberItem
              candidate={candidate}
              checked={selectedCandidateKeys.has(key)}
              key={key}
              onCheckedChange={(checked) => onToggleCandidate(candidate, checked)}
            />
          )
        })}
        {candidates.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {tab === "apps" ? t("createGroup.noApps") : t("createGroup.noContacts")}
          </div>
        )}
      </ItemGroup>
    </div>
  )
})

function CreateGroupMemberItem({
  candidate,
  checked,
  onCheckedChange,
}: {
  candidate: CreateGroupCandidate
  checked: boolean
  onCheckedChange: (checked: boolean | string) => void
}) {
  const displayName = getCreateGroupCandidateDisplayName(candidate)
  const checkboxId = `create-group-member-${candidate.type}-${candidate.id}`

  return (
    <Item
      asChild
      className={cn("cursor-pointer px-2 py-1.5", checked ? "bg-primary/10" : "hover:bg-muted")}
      size="sm"
    >
      <Label htmlFor={checkboxId}>
        <ItemMedia>
          <SelectionListAvatar avatar={candidate.avatar} name={displayName} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="truncate">{displayName}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Checkbox
            aria-label={displayName}
            checked={checked}
            id={checkboxId}
            onCheckedChange={onCheckedChange}
          />
        </ItemActions>
      </Label>
    </Item>
  )
}

type CreateGroupCandidate = ContactUser | ContactApp

function createGroupCandidateKey(candidate: CreateGroupCandidate) {
  return `${candidate.type}:${candidate.id}`
}

function getCreateGroupCandidateDisplayName(candidate: CreateGroupCandidate) {
  return candidate.type === "user" ? getContactDisplayName(candidate) : candidate.name.trim()
}

function getContactDisplayName(contact: { name: string; nickname: string }) {
  const nickname = contact.nickname.trim()

  return nickname || contact.name.trim()
}
