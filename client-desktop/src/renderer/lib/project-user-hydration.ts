import type { ProjectTask, ProjectTaskUser } from "@/components/projects/project-types"
import type { ContactUser } from "@/lib/client-data-api"
import type { ClientProjectMember, ProjectUser } from "@/lib/project-data-api"

export const EMPTY_PROJECT_USERS: Readonly<Record<string, ContactUser>> = Object.freeze({})

type DirectoryBackedUser = {
  avatar: string
  id: string
  name: string
  nickname: string
}

export function hydrateProjectTask(
  task: ProjectTask,
  usersById: Readonly<Record<string, ContactUser>>,
): ProjectTask {
  return {
    ...task,
    assignee: task.assignee ? hydrateTaskUser(task.assignee, usersById) : null,
    creator: hydrateTaskUser(task.creator, usersById),
  }
}

export function hydrateProjectTasks(
  tasks: readonly ProjectTask[],
  usersById: Readonly<Record<string, ContactUser>>,
): ProjectTask[] {
  return tasks.map((task) => hydrateProjectTask(task, usersById))
}

export function getProjectTaskUserIds(tasks: readonly ProjectTask[]): string[] {
  return uniqueIds(tasks.flatMap((task) => [task.creator.id, task.assignee?.id ?? ""]))
}

export function hydrateTaskUser(
  user: ProjectTaskUser,
  usersById: Readonly<Record<string, ContactUser>>,
): ProjectTaskUser {
  const profile = usersById[user.id]
  return profile
    ? { avatar: profile.avatar, id: user.id, name: profile.name, nickname: profile.nickname }
    : user
}

export function hydrateProjectMember(
  member: ClientProjectMember,
  usersById: Readonly<Record<string, ContactUser>>,
): ClientProjectMember {
  const profile = usersById[member.id]
  if (!profile) return member
  const displayName =
    profile.nickname || profile.name || member.displayName || shortUserId(member.id)
  return {
    ...member,
    avatar: profile.avatar,
    displayName,
    email: profile.email,
    name: profile.name,
    nickname: profile.nickname,
  }
}

export function hydrateProjectMembers(
  members: readonly ClientProjectMember[],
  usersById: Readonly<Record<string, ContactUser>>,
): ClientProjectMember[] {
  return members.map((member) => hydrateProjectMember(member, usersById))
}

export function getProjectMemberUserIds(members: readonly ClientProjectMember[]): string[] {
  return uniqueIds(members.map((member) => member.id))
}

export function hydrateProjectOwner(
  owner: ProjectUser,
  usersById: Readonly<Record<string, ContactUser>>,
): ProjectUser {
  const profile = usersById[owner.id]
  return profile
    ? { avatar: profile.avatar, id: owner.id, name: profile.name, nickname: profile.nickname }
    : owner
}

export function hydrateDirectoryUser<T extends DirectoryBackedUser>(
  user: T,
  usersById: Readonly<Record<string, ContactUser>>,
): T {
  const profile = usersById[user.id]
  return profile
    ? { ...user, avatar: profile.avatar, name: profile.name, nickname: profile.nickname }
    : user
}

export function displayDirectoryUser(
  user: Pick<DirectoryBackedUser, "id" | "name" | "nickname">,
): string {
  return user.nickname || user.name || shortUserId(user.id)
}

export function displayProjectUser(
  user: Pick<DirectoryBackedUser, "id" | "name" | "nickname">,
): string {
  return displayDirectoryUser(user)
}

export function displayProjectMember(member: ClientProjectMember): string {
  return member.displayName || displayProjectUser(member)
}

export function shortUserId(userId: string): string {
  return userId.length <= 12 ? userId : `${userId.slice(0, 8)}...${userId.slice(-4)}`
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}
