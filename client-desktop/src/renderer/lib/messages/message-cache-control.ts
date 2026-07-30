import type { AuthenticatedTarget } from "@shared/client-contract"

type MessageCacheClearRegistration = Readonly<{
  clear: () => Promise<void>
  targetKey: string
}>

let activeRegistration: MessageCacheClearRegistration | null = null

export function registerMessageCacheClearHandler(
  target: AuthenticatedTarget,
  clear: () => Promise<void>,
): () => void {
  const registration = { clear, targetKey: messageCacheTargetKey(target) }
  activeRegistration = registration
  return () => {
    if (activeRegistration === registration) activeRegistration = null
  }
}

export async function clearManagedMessageCache(target: AuthenticatedTarget): Promise<boolean> {
  const registration = activeRegistration
  if (!registration || registration.targetKey !== messageCacheTargetKey(target)) return false
  await registration.clear()
  return true
}

export function messageCacheTargetKey(target: AuthenticatedTarget): string {
  return `${target.id}\u0000${target.normalizedUrl}\u0000${target.userId}`
}
