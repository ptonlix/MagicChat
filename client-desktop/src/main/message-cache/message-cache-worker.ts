import { parentPort, workerData } from "node:worker_threads"
import { openMessageCacheStore } from "./message-cache-database"
import { toMessageCacheError } from "./message-cache-errors"
import type {
  MessageCacheWorkerOperation,
  MessageCacheWorkerRequest,
  MessageCacheWorkerResponse,
} from "./message-cache-protocol"

if (!parentPort) throw new Error("message cache worker requires a parent port")
const data = workerData as Readonly<{ databasePath: string }>
const store = openMessageCacheStore(data.databasePath)

parentPort.on("message", (request: MessageCacheWorkerRequest) => {
  let response: MessageCacheWorkerResponse
  try {
    response = { id: request.id, result: execute(request.operation) }
  } catch (error) {
    response = { errorCode: toMessageCacheError(error).code, id: request.id }
  }
  parentPort?.postMessage(response)
})

function execute(operation: MessageCacheWorkerOperation): unknown {
  switch (operation.kind) {
    case "clearAll":
      return store.clearAll()
    case "clearConversation":
      return store.clearConversation(operation.scope)
    case "clearOrphanedServers":
      return store.clearOrphanedServers(operation.targets)
    case "clearServer":
      return store.clearServer(operation.target)
    case "clearUser":
      return store.clearUser(operation.target)
    case "commitAfter":
      return store.commitAfter(operation.scope, operation.commit)
    case "commitBefore":
      return store.commitBefore(operation.scope, operation.commit)
    case "commitLatest":
      return store.commitLatest(operation.scope, operation.commit)
    case "getById":
      return store.getById(operation.scope, operation.messageId)
    case "getStats":
      return store.getStats(operation.target)
    case "getSyncState":
      return store.getSyncState(operation.scope)
    case "health":
      return store.health()
    case "listSyncStates":
      return store.listSyncStates(operation.target)
    case "readBefore":
      return store.readBefore(operation.scope, operation.beforeSeq, operation.limit)
    case "readRecent":
      return store.readRecent(operation.scope, operation.limit)
    case "removeMessage":
      return store.removeMessage(operation.scope, operation.messageId, operation.generation)
    case "upsert":
      return store.upsert(operation.scope, operation.records, operation.generation)
    case "shutdown":
      store.close()
      return undefined
  }
}
