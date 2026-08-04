import { createContext } from "react"

import type { AuthenticatedTarget } from "@shared/client-contract"

export const DesktopTargetContext = createContext<AuthenticatedTarget | null>(null)
