import { MessageCacheError, type MessageCacheErrorCode } from "@shared/message-cache-contract"

export function toMessageCacheError(error: unknown): MessageCacheError {
  if (error instanceof MessageCacheError) return error
  const code = sqliteErrorCode(error)
  return new MessageCacheError(code)
}

function sqliteErrorCode(error: unknown): MessageCacheErrorCode {
  const value = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : ""
  if (value.includes("full") || value.includes("enospc")) return "cache_disk_full"
  if (value.includes("permission") || value.includes("access") || value.includes("eperm"))
    return "cache_permission_denied"
  if (value.includes("corrupt") || value.includes("malformed")) return "cache_corrupt"
  if (value.includes("busy") || value.includes("locked")) return "cache_busy"
  if (value.includes("generation") && value.includes("stale")) return "cache_generation_stale"
  if (value.includes("schema") && value.includes("new")) return "cache_schema_too_new"
  return "cache_unavailable"
}
