import { useContext } from "react"

import type { AuthenticatedTarget } from "@shared/client-contract"
import { DesktopTargetContext } from "@/lib/desktop-target-context"

export function useDesktopTarget(): AuthenticatedTarget {
  const target = useContext(DesktopTargetContext)
  if (!target) throw new Error("文档工作区缺少认证目标")
  return target
}
