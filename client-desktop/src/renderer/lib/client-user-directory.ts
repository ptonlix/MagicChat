import type { ContactUser, ResolvedClientUser } from "@/lib/client-data-api"

const profileTTL = 5 * 60 * 1_000
const negativeTTL = 30 * 1_000
const resolveBatchSize = 100

type DirectoryEntity = {
  fetchedAt: number
  generation: number
  minimumUpdatedAt?: string
  negativeUntil: number
  pending?: PendingUser
  profile?: ResolvedClientUser
}

type PendingUser = {
  generation: number
  reject: (reason?: unknown) => void
  resolve: () => void
}

type ResolveUsers = (
  userIds: readonly string[],
  signal: AbortSignal,
) => Promise<ResolvedClientUser[]>

export class ClientUserDirectory {
  private readonly entities = new Map<string, DirectoryEntity>()
  private readonly queuedIds = new Set<string>()
  private readonly controllers = new Set<AbortController>()
  private scheduled = false
  private epoch = 0

  constructor(
    private readonly resolveUsers: ResolveUsers,
    private readonly onChange: (usersById: Readonly<Record<string, ContactUser>>) => void,
    private readonly now: () => number = Date.now,
  ) {}

  ensureUsers(userIds: readonly string[]) {
    const promises = uniqueUserIds(userIds).map((userId) => this.ensureUser(userId))
    return Promise.all(promises).then(() => undefined)
  }

  getUser(userId: string): ContactUser | undefined {
    return this.entities.get(userId)?.profile
  }

  getUsersById(): Readonly<Record<string, ContactUser>> {
    const users: Record<string, ContactUser> = {}
    for (const [id, entity] of this.entities) {
      if (entity.profile) users[id] = entity.profile
    }
    return users
  }

  seed(users: readonly ResolvedClientUser[]) {
    let changed = false
    for (const user of users) {
      const entity = this.getOrCreate(user.id)
      if (user.updatedAt && this.canCommit(entity, user.updatedAt)) {
        entity.profile = user
        entity.fetchedAt = this.now()
        entity.negativeUntil = 0
        changed = true
      } else if (!entity.profile && !user.updatedAt) {
        entity.profile = user
        entity.fetchedAt = 0
        changed = true
      }
    }
    if (changed) this.emit()
  }

  invalidateUsers(userIds: readonly string[], minimumUpdatedAt?: string) {
    const validMinimum =
      minimumUpdatedAt && isValidDate(minimumUpdatedAt) ? minimumUpdatedAt : undefined
    let changed = false
    for (const userId of uniqueUserIds(userIds)) {
      const entity = this.getOrCreate(userId)
      entity.generation += 1
      entity.pending?.reject(new DOMException("用户资料已失效", "AbortError"))
      entity.pending = undefined
      entity.fetchedAt = 0
      entity.negativeUntil = 0
      if (
        validMinimum &&
        (!entity.minimumUpdatedAt || compareVersions(validMinimum, entity.minimumUpdatedAt) > 0)
      ) {
        entity.minimumUpdatedAt = validMinimum
      }
      if (entity.profile) changed = true
      void this.ensureUser(userId).catch(() => undefined)
    }
    if (changed) this.emit()
  }

  updateUserPresence(userId: string, online: boolean, lastOnlineAt?: string | null) {
    if (!userId.trim() || typeof online !== "boolean") return
    const entity = this.entities.get(userId)
    if (!entity?.profile) return
    if (lastOnlineAt !== undefined && lastOnlineAt !== null && !isValidDate(lastOnlineAt)) return
    entity.profile = {
      ...entity.profile,
      lastOnlineAt: lastOnlineAt ?? entity.profile.lastOnlineAt,
      online,
    }
    this.emit()
  }

  clear(emit = true) {
    this.epoch += 1
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    for (const entity of this.entities.values())
      entity.pending?.reject(new DOMException("已清理用户目录", "AbortError"))
    this.entities.clear()
    this.queuedIds.clear()
    this.scheduled = false
    if (emit) this.emit()
  }

  private ensureUser(userId: string): Promise<void> {
    const entity = this.getOrCreate(userId)
    const currentTime = this.now()
    if (entity.profile && currentTime - entity.fetchedAt < profileTTL) return Promise.resolve()
    if (entity.negativeUntil > currentTime) return Promise.resolve()
    if (entity.pending) {
      return new Promise<void>((resolve, reject) => {
        const pending = entity.pending!
        const resolvePrevious = pending.resolve
        const rejectPrevious = pending.reject
        pending.resolve = () => {
          resolvePrevious()
          resolve()
        }
        pending.reject = (reason) => {
          rejectPrevious(reason)
          reject(reason)
        }
      })
    }
    const promise = new Promise<void>((resolve, reject) => {
      entity.pending = { generation: entity.generation, reject, resolve }
    })
    this.queuedIds.add(userId)
    this.scheduleFlush()
    return promise
  }

  private scheduleFlush() {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.flush()
    })
  }

  private async flush() {
    if (this.queuedIds.size === 0) return
    const ids = Array.from(this.queuedIds)
    this.queuedIds.clear()
    for (let start = 0; start < ids.length; start += resolveBatchSize) {
      const batch = ids.slice(start, start + resolveBatchSize)
      await this.resolveBatch(batch)
    }
  }

  private async resolveBatch(userIds: string[]) {
    const controller = new AbortController()
    this.controllers.add(controller)
    const epoch = this.epoch
    const generations = new Map(
      userIds.map((id) => [id, this.entities.get(id)?.pending?.generation ?? -1]),
    )
    try {
      const profiles = await this.resolveUsers(userIds, controller.signal)
      if (epoch !== this.epoch || controller.signal.aborted) return
      const returnedIds = new Set(profiles.map((profile) => profile.id))
      let changed = false
      for (const profile of profiles) {
        const entity = this.entities.get(profile.id)
        if (!entity || generations.get(profile.id) !== entity.generation) continue
        if (this.canCommit(entity, profile.updatedAt)) {
          entity.profile = profile
          entity.fetchedAt = this.now()
          entity.negativeUntil = 0
          changed = true
        }
      }
      for (const userId of userIds) {
        const entity = this.entities.get(userId)
        if (!entity || generations.get(userId) !== entity.generation) continue
        if (!returnedIds.has(userId)) entity.negativeUntil = this.now() + negativeTTL
        const pending = entity.pending
        entity.pending = undefined
        pending?.resolve()
      }
      if (changed) this.emit()
    } catch (error) {
      if (epoch !== this.epoch || controller.signal.aborted) return
      for (const userId of userIds) {
        const entity = this.entities.get(userId)
        if (!entity || generations.get(userId) !== entity.generation) continue
        const pending = entity.pending
        entity.pending = undefined
        pending?.reject(error)
      }
    } finally {
      this.controllers.delete(controller)
    }
  }

  private canCommit(entity: DirectoryEntity, updatedAt: string) {
    if (!isValidDate(updatedAt)) return !entity.profile?.updatedAt
    if (entity.minimumUpdatedAt && compareVersions(updatedAt, entity.minimumUpdatedAt) < 0)
      return false
    return !entity.profile?.updatedAt || compareVersions(updatedAt, entity.profile.updatedAt) >= 0
  }

  private getOrCreate(userId: string) {
    const entity = this.entities.get(userId)
    if (entity) return entity
    const created: DirectoryEntity = { fetchedAt: 0, generation: 0, negativeUntil: 0 }
    this.entities.set(userId, created)
    return created
  }

  private emit() {
    this.onChange(this.getUsersById())
  }
}

function uniqueUserIds(ids: readonly string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value))
}

function compareVersions(left: string, right: string) {
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  if (leftTime !== rightTime) return leftTime - rightTime
  return left.localeCompare(right)
}
