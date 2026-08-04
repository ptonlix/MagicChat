import { describe, expect, it } from "vitest"

import { DocumentBodySyncController } from "./document-body-sync"

describe("DocumentBodySyncController", () => {
  it("区分连接中、同步中、已同步和失败", () => {
    const controller = new DocumentBodySyncController()

    expect(controller.value).toEqual({ state: "connecting", unsyncedChanges: 0 })
    expect(controller.setUnsyncedChanges(2)).toEqual({ state: "saving", unsyncedChanges: 2 })
    expect(controller.synchronized()).toEqual({ state: "saving", unsyncedChanges: 2 })
    expect(controller.setUnsyncedChanges(0)).toEqual({ state: "saved", unsyncedChanges: 0 })
    expect(controller.disconnected()).toEqual({ state: "failed", unsyncedChanges: 0 })
  })

  it("重连后必须重新等待同步确认，并保留未确认变更计数", () => {
    const controller = new DocumentBodySyncController()
    controller.synchronized()
    controller.setUnsyncedChanges(1)

    expect(controller.connecting()).toEqual({ state: "connecting", unsyncedChanges: 1 })
    expect(controller.synchronized()).toEqual({ state: "saving", unsyncedChanges: 1 })
    expect(controller.setUnsyncedChanges(0)).toEqual({ state: "saved", unsyncedChanges: 0 })
    expect(() => controller.setUnsyncedChanges(-1)).toThrow("正文未同步变更数无效")
  })
})
