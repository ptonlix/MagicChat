import * as React from "react"
import { Search, UserPlus } from "lucide-react"

import { cn } from "@/lib/utils"
import { useClientData } from "@/lib/client-data-context"
import type {
  ClientConversation,
  ClientConversationMember,
  ClientUser,
  ContactUser,
} from "@/lib/client-data-api"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  DialogTrigger,
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

type AddGroupMembersDialogProps = {
  conversation: ClientConversation
}

type AddGroupMemberCandidate = Pick<
  ContactUser,
  "avatar" | "email" | "id" | "name" | "nickname" | "phone"
>

export function AddGroupMembersDialog({
  conversation,
}: AddGroupMembersDialogProps) {
  const { contacts, me } = useClientData()
  const [keyword, setKeyword] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const existingMemberIds = React.useMemo(
    () => new Set((conversation.members ?? []).map((member) => member.id)),
    [conversation.members]
  )
  const [selectedMemberIds, setSelectedMemberIds] = React.useState<Set<string>>(
    () => new Set(existingMemberIds)
  )
  const candidates = React.useMemo(
    () => createMemberCandidates(conversation.members ?? [], me, contacts),
    [contacts, conversation.members, me]
  )
  const filteredCandidates = React.useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    if (!normalizedKeyword) {
      return candidates
    }

    return candidates.filter((candidate) =>
      [
        candidate.email,
        candidate.name,
        candidate.nickname,
        candidate.phone,
      ].some((value) => value.toLowerCase().includes(normalizedKeyword))
    )
  }, [candidates, keyword])
  const newMemberCount = Array.from(selectedMemberIds).filter(
    (memberId) => !existingMemberIds.has(memberId)
  ).length

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setKeyword("")
      setSelectedMemberIds(new Set(existingMemberIds))
    }

    setOpen(nextOpen)
  }

  function toggleMember(candidateId: string, checked: boolean | string) {
    if (existingMemberIds.has(candidateId)) {
      return
    }

    setSelectedMemberIds((currentIds) => {
      const nextChecked = Boolean(checked)
      const currentChecked = currentIds.has(candidateId)

      if (currentChecked === nextChecked) {
        return currentIds
      }

      const nextIds = new Set(currentIds)

      if (nextChecked) {
        nextIds.add(candidateId)
      } else {
        nextIds.delete(candidateId)
      }

      return nextIds
    })
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (newMemberCount === 0) {
      return
    }

    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          aria-label="添加成员"
          size="icon-sm"
          title="添加成员"
          type="button"
          variant="ghost"
        >
          <UserPlus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">添加成员</DialogTitle>
          <DialogDescription className="sr-only">
            选择联系人添加到当前群聊
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="add-group-member-search">选择成员</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                id="add-group-member-search"
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索联系人"
                type="search"
                value={keyword}
              />
            </div>
          </div>
          <div className="h-64 overflow-y-auto rounded-md border">
            <ItemGroup
              aria-label="添加群聊成员"
              className="gap-1 p-2 has-data-[size=sm]:gap-1"
              role="group"
            >
              {filteredCandidates.map((candidate) => {
                const existing = existingMemberIds.has(candidate.id)

                return (
                  <AddGroupMemberItem
                    candidate={candidate}
                    checked={selectedMemberIds.has(candidate.id)}
                    disabled={existing}
                    key={candidate.id}
                    onCheckedChange={(checked) =>
                      toggleMember(candidate.id, checked)
                    }
                  />
                )
              })}
              {filteredCandidates.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  没有匹配的联系人
                </div>
              )}
            </ItemGroup>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button disabled={newMemberCount === 0} type="submit">
              添加
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddGroupMemberItem({
  candidate,
  checked,
  disabled,
  onCheckedChange,
}: {
  candidate: AddGroupMemberCandidate
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean | string) => void
}) {
  const checkboxId = `add-group-member-${candidate.id}`
  const displayName = getMemberDisplayName(candidate)

  return (
    <Item
      asChild
      className={cn(
        "px-2 py-1.5",
        disabled ? "cursor-default opacity-75" : "cursor-pointer",
        checked ? "bg-primary/10" : "hover:bg-muted"
      )}
      size="sm"
    >
      <Label htmlFor={checkboxId}>
        <ItemMedia>
          <Avatar
            className="rounded-sm bg-muted after:rounded-sm"
            data-size="sm"
          >
            {candidate.avatar && (
              <AvatarImage
                alt={displayName}
                className="rounded-sm"
                src={candidate.avatar}
              />
            )}
            <AvatarFallback className="rounded-sm">
              {getInitial(displayName)}
            </AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="truncate">{displayName}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Checkbox
            aria-label={displayName}
            checked={checked}
            disabled={disabled}
            id={checkboxId}
            onCheckedChange={onCheckedChange}
          />
        </ItemActions>
      </Label>
    </Item>
  )
}

function createMemberCandidates(
  members: ClientConversationMember[],
  currentUser: ClientUser,
  contacts: ContactUser[]
) {
  const candidatesById = new Map<string, AddGroupMemberCandidate>()

  for (const member of members) {
    candidatesById.set(member.id, member)
  }

  candidatesById.set(currentUser.id, currentUser)

  for (const contact of contacts) {
    candidatesById.set(contact.id, contact)
  }

  return Array.from(candidatesById.values())
}

function getMemberDisplayName(
  member: Pick<AddGroupMemberCandidate, "name" | "nickname">
) {
  return member.nickname.trim() || member.name.trim()
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
