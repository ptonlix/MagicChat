import { UserRound } from "lucide-react"

import { useClientData } from "@/lib/client-data-context"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

type DirectConversationInfoProps = {
  userId: string
}

export function DirectConversationInfo({
  userId,
}: DirectConversationInfoProps) {
  const { contacts, me } = useClientData()
  const user =
    me.id === userId ? me : contacts.find((contact) => contact.id === userId)

  if (!user) {
    return (
      <>
        <SheetHeader className="border-b">
          <SheetTitle>会话信息</SheetTitle>
          <SheetDescription>单聊</SheetDescription>
        </SheetHeader>
        <div className="px-4 py-6 text-sm text-muted-foreground">
          用户信息不可用
        </div>
      </>
    )
  }

  const displayName = getUserDisplayName(user)

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>会话信息</SheetTitle>
        <SheetDescription>单聊</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-5 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-14 rounded-sm bg-muted after:rounded-sm">
            {user.avatar && (
              <AvatarImage
                alt={displayName}
                className="rounded-sm"
                src={user.avatar}
              />
            )}
            <AvatarFallback className="rounded-sm text-lg">
              {getUserInitial(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{displayName}</div>
            <div className="truncate text-xs text-muted-foreground">
              用户资料
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-b py-2 text-sm last:border-b-0">
          <UserRound className="size-4 text-muted-foreground" />
          <span className="w-12 shrink-0 text-muted-foreground">姓名</span>
          <span className="min-w-0 truncate">{user.name}</span>
        </div>
      </div>
    </>
  )
}

function getUserDisplayName(user: { name: string; nickname: string }) {
  const name = user.name.trim()
  const nickname = user.nickname.trim()

  if (!nickname) {
    return name || "未命名用户"
  }

  if (!name || nickname === name) {
    return nickname
  }

  return `${nickname} | ${name}`
}

function getUserInitial(displayName: string) {
  return Array.from(displayName.trim())[0]?.toUpperCase() ?? "?"
}
