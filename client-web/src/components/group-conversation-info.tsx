import { LogOut, UsersRound } from "lucide-react"

import type { ClientConversationMember } from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

type GroupConversationInfoProps = {
  conversationId: string
}

export function GroupConversationInfo({
  conversationId,
}: GroupConversationInfoProps) {
  const { getConversation } = useClientData()
  const conversation = getConversation(conversationId)

  if (!conversation) {
    return (
      <>
        <SheetHeader className="border-b">
          <SheetTitle>群聊信息</SheetTitle>
          <SheetDescription>群聊</SheetDescription>
        </SheetHeader>
        <div className="px-4 py-6 text-sm text-muted-foreground">
          会话信息不可用
        </div>
      </>
    )
  }

  const members = conversation.members ?? []

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>群聊信息</SheetTitle>
        <SheetDescription>{conversation.memberCount} 人群聊</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar className="size-14 rounded-sm bg-muted after:rounded-sm">
              {conversation.avatar && (
                <AvatarImage
                  alt={conversation.name}
                  className="rounded-sm"
                  src={conversation.avatar}
                />
              )}
              <AvatarFallback className="rounded-sm text-lg">
                {getInitial(conversation.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {conversation.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">群聊</div>
            </div>
          </div>

          <div className="flex items-center gap-3 border-b py-2 text-sm">
            <UsersRound className="size-4 text-muted-foreground" />
            <span className="w-12 shrink-0 text-muted-foreground">群名</span>
            <span className="min-w-0 truncate">{conversation.name}</span>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-medium">
              群成员（{conversation.memberCount}）
            </div>
            <div className="grid gap-1">
              {members.map((member) => (
                <GroupMemberItem key={member.id} member={member} />
              ))}
              {members.length === 0 && (
                <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                  暂无成员信息
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <SheetFooter className="border-t">
        <Button type="button" variant="destructive">
          <LogOut aria-hidden="true" className="size-4" />
          退出群聊
        </Button>
      </SheetFooter>
    </>
  )
}

function GroupMemberItem({ member }: { member: ClientConversationMember }) {
  const displayName = getMemberDisplayName(member)

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
      <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
        {member.avatar && (
          <AvatarImage
            alt={displayName}
            className="rounded-sm"
            src={member.avatar}
          />
        )}
        <AvatarFallback className="rounded-sm">
          {getInitial(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate">{displayName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {getMemberRoleLabel(member.role)}
        </div>
      </div>
    </div>
  )
}

function getMemberDisplayName(
  member: Pick<ClientConversationMember, "name" | "nickname">
) {
  return member.nickname.trim() || member.name.trim()
}

function getMemberRoleLabel(role: ClientConversationMember["role"]) {
  if (role === "owner") {
    return "群主"
  }
  if (role === "admin") {
    return "管理员"
  }

  return "成员"
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
