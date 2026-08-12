import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { ClientProjectMember } from "@/lib/project-data-api"
import { getAvatarInitial } from "@/lib/avatar"
import { displayProjectMember } from "@/lib/project-user-hydration"
import { cn } from "@/lib/utils"

export function ProjectMemberAvatar({
  className = "size-6",
  fallbackClassName,
  member,
}: {
  className?: string
  fallbackClassName?: string
  member: ClientProjectMember
}) {
  const displayName = displayProjectMember(member)

  return (
    <Avatar className={cn(className, "shrink-0 rounded-sm after:rounded-sm")}>
      {member.avatar && (
        <AvatarImage alt={displayName} className="rounded-sm" src={member.avatar} />
      )}
      <AvatarFallback className={cn("rounded-sm", fallbackClassName)}>
        {getAvatarInitial(displayName)}
      </AvatarFallback>
    </Avatar>
  )
}
