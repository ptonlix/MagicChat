export type DocumentBodySyncState = "connecting" | "failed" | "saved" | "saving"

export type DocumentBodySyncSnapshot = Readonly<{
  state: DocumentBodySyncState
  unsyncedChanges: number
}>

export class DocumentBodySyncController {
  private snapshot: DocumentBodySyncSnapshot = Object.freeze({
    state: "connecting",
    unsyncedChanges: 0,
  })
  private synced = false

  connecting(): DocumentBodySyncSnapshot {
    this.synced = false
    return this.update("connecting", this.snapshot.unsyncedChanges)
  }

  disconnected(): DocumentBodySyncSnapshot {
    this.synced = false
    return this.update("failed", this.snapshot.unsyncedChanges)
  }

  failed(): DocumentBodySyncSnapshot {
    return this.update("failed", this.snapshot.unsyncedChanges)
  }

  synchronized(): DocumentBodySyncSnapshot {
    this.synced = true
    return this.update(this.snapshot.unsyncedChanges > 0 ? "saving" : "saved")
  }

  setUnsyncedChanges(count: number): DocumentBodySyncSnapshot {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("正文未同步变更数无效")
    return this.update(count > 0 ? "saving" : this.synced ? "saved" : "connecting", count)
  }

  get value(): DocumentBodySyncSnapshot {
    return this.snapshot
  }

  private update(
    state: DocumentBodySyncState,
    unsyncedChanges = this.snapshot.unsyncedChanges,
  ): DocumentBodySyncSnapshot {
    this.snapshot = Object.freeze({ state, unsyncedChanges })
    return this.snapshot
  }
}
