import { createContext, useContext } from "react"

import type { ClientUser } from "@/lib/client-data-api"
import type { ClientProjectSummary } from "@/lib/project-data-api"

export type DocumentDataContextValue = Readonly<{
  loadMoreProjects(): Promise<void>
  me: ClientUser
  personalProject: ClientProjectSummary
  projects: readonly ClientProjectSummary[]
  projectsLoadingMore: boolean
  projectsNextCursor: string | null
  refreshMe(): Promise<void>
  refreshProjects(): Promise<void>
}>

export const DocumentDataContext = createContext<DocumentDataContextValue | null>(null)

export function useDocumentData() {
  const context = useContext(DocumentDataContext)
  if (!context) throw new Error("useDocumentData must be used within DocumentDataProvider")
  return context
}
