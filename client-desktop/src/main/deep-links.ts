export type DeepLinkAction =
  | { conversationId: string; kind: "conversation"; messageId?: string; serverId: string }
  | { kind: "unknown-server"; rawUrl: string; serverId: string }

export function parseDeepLink(rawUrl: string, knownServers: ReadonlySet<string>): DeepLinkAction {
  if (rawUrl.length > 4096) throw new Error("深链接过长")
  const url = new URL(rawUrl)
  if (url.protocol !== "magicchat:") throw new Error("深链接协议无效")
  if (url.username || url.password) throw new Error("深链接不能包含凭据")
  for (const key of url.searchParams.keys()) if (/token|cookie|session|password|secret/i.test(key)) throw new Error("深链接包含敏感参数")
  const parts = url.pathname.split("/").filter(Boolean)
  if (url.hostname !== "v1" || parts[0] !== "server" || parts[2] !== "conversation" || parts.length !== 4) throw new Error("深链接路由无效")
  const [serverId, conversationId] = [parts[1], parts[3]]
  if (![serverId, conversationId].every((value) => /^[a-zA-Z0-9-]{1,128}$/.test(value))) throw new Error("深链接标识无效")
  if (!knownServers.has(serverId)) return { kind: "unknown-server", rawUrl, serverId }
  const messageId = url.searchParams.get("message") ?? undefined
  if (messageId && !/^[a-zA-Z0-9-]{1,128}$/.test(messageId)) throw new Error("消息标识无效")
  return { conversationId, kind: "conversation", messageId, serverId }
}
