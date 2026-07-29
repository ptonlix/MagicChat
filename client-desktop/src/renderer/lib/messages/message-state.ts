import type { ClientMessage } from "@/lib/client-data-api"

export function preserveNewerMessageState(
  current: ClientMessage | undefined,
  incoming: ClientMessage,
): ClientMessage {
  if (!current) return incoming
  if (current.body.type === "revoked" && incoming.body.type !== "revoked") return current

  let next = incoming
  if ((current.reactionVersion ?? 0) > (incoming.reactionVersion ?? 0)) {
    next = {
      ...next,
      reactionVersion: current.reactionVersion,
      reactions: current.reactions,
    }
  }
  if (current.choice && incoming.choice) {
    if (
      current.choice.responseCount > incoming.choice.responseCount ||
      (current.choice.responseCount === incoming.choice.responseCount &&
        current.choice.myOptionIds.length > 0 &&
        incoming.choice.myOptionIds.length === 0)
    ) {
      next = { ...next, choice: current.choice }
    }
  } else if (current.choice && !incoming.choice && incoming.body.type === "choice") {
    next = { ...next, choice: current.choice }
  }
  if (current.topic && !incoming.topic) next = { ...next, topic: current.topic }
  return next
}

export function mergeManagedMessages(
  currentMessages: ReadonlyArray<ClientMessage>,
  incomingMessages: ReadonlyArray<ClientMessage>,
  isDeleted: (message: ClientMessage) => boolean = () => false,
): ClientMessage[] {
  const byId = new Map(currentMessages.map((message) => [message.id, message]))
  for (const incoming of incomingMessages) {
    if (isDeleted(incoming)) continue
    byId.set(incoming.id, preserveNewerMessageState(byId.get(incoming.id), incoming))
  }
  return [...byId.values()].sort((left, right) =>
    left.seq === right.seq
      ? left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      : left.seq - right.seq,
  )
}
