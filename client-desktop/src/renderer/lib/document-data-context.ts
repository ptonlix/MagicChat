import { createContext, useContext } from "react"

import type { ClientUser } from "@/lib/client-data-api"

export type DocumentDataContextValue = Readonly<{
  me: ClientUser
  refreshMe(): Promise<void>
  refreshProjects(): Promise<void>
}>

export const DocumentDataContext = createContext<DocumentDataContextValue | null>(null)

export function useDocumentData() {
  const context = useContext(DocumentDataContext)
  if (!context) throw new Error("useDocumentData must be used within DocumentDataProvider")
  return context
}
