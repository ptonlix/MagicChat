import type { ReactNode } from "react"

import type { AuthenticatedTarget } from "@shared/client-contract"
import { DesktopTargetContext } from "@/lib/desktop-target-context"

export function DesktopTargetProvider({
  children,
  target,
}: {
  children: ReactNode
  target: AuthenticatedTarget
}) {
  return <DesktopTargetContext.Provider value={target}>{children}</DesktopTargetContext.Provider>
}
