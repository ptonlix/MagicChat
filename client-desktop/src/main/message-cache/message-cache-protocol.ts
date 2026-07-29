import type {
  MessageCacheCommit,
  MessageCacheGeneration,
  MessageCacheRecord,
  MessageCacheScope,
} from "@shared/message-cache-contract"
import type { AuthenticatedTarget } from "@shared/client-contract"

export type MessageCacheWorkerOperation =
  | Readonly<{ kind: "clearAll" }>
  | Readonly<{ kind: "clearConversation"; scope: MessageCacheScope }>
  | Readonly<{
      kind: "clearServer"
      target: Pick<AuthenticatedTarget, "id" | "normalizedUrl">
    }>
  | Readonly<{ kind: "clearUser"; target: AuthenticatedTarget }>
  | Readonly<{ commit: MessageCacheCommit; kind: "commitAfter"; scope: MessageCacheScope }>
  | Readonly<{ commit: MessageCacheCommit; kind: "commitBefore"; scope: MessageCacheScope }>
  | Readonly<{ commit: MessageCacheCommit; kind: "commitLatest"; scope: MessageCacheScope }>
  | Readonly<{ kind: "getById"; messageId: string; scope: MessageCacheScope }>
  | Readonly<{ kind: "getStats"; target?: AuthenticatedTarget }>
  | Readonly<{ kind: "getSyncState"; scope: MessageCacheScope }>
  | Readonly<{ kind: "health" }>
  | Readonly<{ kind: "listSyncStates"; target: AuthenticatedTarget }>
  | Readonly<{ beforeSeq: number; kind: "readBefore"; limit: number; scope: MessageCacheScope }>
  | Readonly<{ kind: "readRecent"; limit: number; scope: MessageCacheScope }>
  | Readonly<{
      generation: MessageCacheGeneration
      kind: "removeMessage"
      messageId: string
      scope: MessageCacheScope
    }>
  | Readonly<{ kind: "shutdown" }>
  | Readonly<{
      generation: MessageCacheGeneration
      kind: "upsert"
      records: ReadonlyArray<MessageCacheRecord>
      scope: MessageCacheScope
    }>

export type MessageCacheWorkerRequest = Readonly<{
  id: number
  operation: MessageCacheWorkerOperation
}>

export type MessageCacheWorkerResponse = Readonly<{
  errorCode?: string
  id: number
  result?: unknown
}>
