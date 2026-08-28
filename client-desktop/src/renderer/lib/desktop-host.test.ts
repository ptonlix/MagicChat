import { afterEach, describe, expect, it, vi } from "vitest"

import {
  configureDesktopHost,
  isHostMessageNotificationSoundEnabled,
  isHostMessageNotificationsEnabled,
  setHostBadge,
  setHostTrayMessages,
} from "@/lib/desktop-host"

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

describe("desktop host message notifications master switch", () => {
  it("defaults to enabled when the host does not provide the master switch", () => {
    expect(isHostMessageNotificationsEnabled()).toBe(true)
  })

  it("gates sound preference off when the master switch is disabled", () => {
    restoreHost = configureDesktopHost({
      messageNotificationsEnabled: () => false,
      messageNotificationSoundEnabled: () => true,
    })

    expect(isHostMessageNotificationsEnabled()).toBe(false)
    expect(isHostMessageNotificationSoundEnabled()).toBe(false)
  })

  it("forces badge and tray messages to zero or empty while disabled", () => {
    const setBadge = vi.fn()
    const setTrayMessages = vi.fn()
    restoreHost = configureDesktopHost({
      messageNotificationsEnabled: () => false,
      setBadge,
      setTrayMessages,
    })

    setHostBadge(5)
    setHostTrayMessages([{ conversationId: "c1", name: "会话", summary: "摘要", unreadCount: 2 }])

    expect(setBadge).toHaveBeenCalledWith(0)
    expect(setTrayMessages).toHaveBeenCalledWith([])
  })

  it("publishes current values while enabled", () => {
    const setBadge = vi.fn()
    const setTrayMessages = vi.fn()
    restoreHost = configureDesktopHost({
      setBadge,
      setTrayMessages,
    })

    setHostBadge(3)
    setHostTrayMessages([{ conversationId: "c1", name: "会话", summary: "摘要", unreadCount: 1 }])

    expect(setBadge).toHaveBeenCalledWith(3)
    expect(setTrayMessages).toHaveBeenCalledWith([
      { conversationId: "c1", name: "会话", summary: "摘要", unreadCount: 1 },
    ])
  })
})
