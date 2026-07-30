import type { AuthenticatedTarget } from "@shared/client-contract"

export function handleUnauthorizedCacheLifecycle(
  target: AuthenticatedTarget,
  dependencies: Readonly<{
    broadcastUnauthorized(target: AuthenticatedTarget): void
    clearUserBestEffort(target: AuthenticatedTarget): void
    closeRealtime(target: AuthenticatedTarget): void
  }>,
): void {
  dependencies.closeRealtime(target)
  try {
    dependencies.clearUserBestEffort(target)
  } catch {
    // 认证失效是安全强制路径，同步校验错误也不能阻止切换登录状态。
  }
  dependencies.broadcastUnauthorized(target)
}
