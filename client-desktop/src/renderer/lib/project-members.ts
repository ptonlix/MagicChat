import {
  listClientProjectMembers,
  type ClientProjectMember,
} from "@/lib/project-data-api"

export async function listAllClientProjectMembers(projectId: string) {
  const members: ClientProjectMember[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await listClientProjectMembers(projectId, {
      cursor,
      limit: 100,
    })
    members.push(...page.members)
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      break
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)

  return members
}

export function projectMemberMatchesQuery(
  member: ClientProjectMember,
  query: string
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return [member.displayName, member.name, member.email].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery)
  )
}
