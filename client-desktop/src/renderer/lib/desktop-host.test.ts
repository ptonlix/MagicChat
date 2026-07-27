import { afterEach, describe, expect, it } from "vitest"

import { configureDesktopHost, isHostMessageNotificationSoundEnabled } from "@/lib/desktop-host"

let restoreHost: (() => void) | undefined

afterEach(() => {
  restoreHost?.()
  restoreHost = undefined
})

describe("desktop host message notification sound", () => {
  it("defaults to enabled when the host does not provide a preference", () => {
    expect(isHostMessageNotificationSoundEnabled()).toBe(true)
  })

  it("reads and restores the host preference", () => {
    restoreHost = configureDesktopHost({
      messageNotificationSoundEnabled: () => false,
    })

    expect(isHostMessageNotificationSoundEnabled()).toBe(false)
    restoreHost()
    restoreHost = undefined
    expect(isHostMessageNotificationSoundEnabled()).toBe(true)
  })
})
