import type { ClientMessage } from "@/lib/client-data-api"

export function preserveNewerMessageState(
  current: ClientMessage | undefined,
  incoming: ClientMessage,
): ClientMessage {
  if (!current) return incoming
  if (current.body.type === "revoked" && incoming.body.type !== "revoked") return current

  let next = incoming
  if (
    current.body.type === "revoked" &&
    current.body.editableBody &&
    incoming.body.type === "revoked" &&
    !incoming.body.editableBody
  ) {
    next = { ...next, body: current.body }
  }
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
  const idByClientMessageId = new Map(
    currentMessages
      .filter((message) => Boolean(message.clientMessageId))
      .map((message) => [message.clientMessageId, message.id]),
  )
  for (const incoming of incomingMessages) {
    if (isDeleted(incoming)) continue
    const existingId = incoming.clientMessageId
      ? idByClientMessageId.get(incoming.clientMessageId)
      : undefined
    const current = byId.get(existingId ?? incoming.id)
    if (current && !current.deliveryStatus && incoming.deliveryStatus) continue
    if (existingId && existingId !== incoming.id) byId.delete(existingId)
    byId.set(incoming.id, preserveNewerMessageState(current, incoming))
    if (incoming.clientMessageId) idByClientMessageId.set(incoming.clientMessageId, incoming.id)
  }
  return [...byId.values()].sort((left, right) =>
    left.seq === right.seq
      ? left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      : left.seq - right.seq,
  )
}
