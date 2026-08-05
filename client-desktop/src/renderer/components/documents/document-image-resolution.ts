import * as React from "react"

export type DocumentImageResolution =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "failed" }>
  | Readonly<{ expiresAt: string; status: "ready"; url: string }>

export const DocumentImageResolutionContext = React.createContext<
  Readonly<{
    refresh(fileId: string): void
    resolutions: ReadonlyMap<string, DocumentImageResolution>
  }>
>({ refresh: () => undefined, resolutions: new Map() })
