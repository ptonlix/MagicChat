export const projectSections = ["tasks", "goals", "discussions", "documents", "members"] as const
export type ProjectSection = (typeof projectSections)[number]

export function isProjectSection(value: string | undefined): value is ProjectSection {
  return projectSections.some((section) => section === value)
}

export function projectSectionPath(
  projectId: string,
  section: ProjectSection,
  search = "",
): string {
  const query = search && !search.startsWith("?") ? `?${search}` : search
  return `/projects/${encodeURIComponent(projectId)}/${section}${query}`
}

export function normalizeProjectSectionPath(
  projectId: string,
  section: string | undefined,
  search = "",
): string {
  const normalizedSection = section === "topics" ? "discussions" : section
  return projectSectionPath(
    projectId,
    isProjectSection(normalizedSection) ? normalizedSection : "tasks",
    search,
  )
}
