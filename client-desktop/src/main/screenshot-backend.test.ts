import { describe, expect, it, vi } from "vitest"
import {
  captureThumbnailSize,
  ElectronDesktopCapturerBackend,
  matchCaptureSources,
  ScreenshotCaptureError,
} from "@main/screenshot-backend"

function source(
  displayId: string,
  width = 200,
  height = 100,
  png = Buffer.from([137, 80, 78, 71, 1]),
) {
  return {
    display_id: displayId,
    id: `screen:${displayId}:0`,
    thumbnail: {
      getSize: () => ({ height, width }),
      isEmpty: () => false,
      toPNG: () => png,
    },
  }
}

const displays = [
  { bounds: { height: 900, width: 1440, x: 0, y: 0 }, id: 7, scaleFactor: 2 },
  { bounds: { height: 1080, width: 1920, x: 1440, y: 0 }, id: 9, scaleFactor: 1 },
]

describe("ElectronDesktopCapturerBackend", () => {
  it("uses one maximum physical thumbnail size", () => {
    expect(captureThumbnailSize(displays)).toEqual({ height: 1800, width: 2880 })
  })

  it("matches multi-display sources only by stable identity", () => {
    const matched = matchCaptureSources(displays, [source("9"), source("7")])
    expect(matched.map((item) => item.source.display_id)).toEqual(["7", "9"])
    expect(() => matchCaptureSources(displays, [source(""), source("")])).toThrowError(
      new ScreenshotCaptureError("unsupported_multi_display"),
    )
  })

  it("allows the unique-source fallback only for one display", () => {
    expect(matchCaptureSources([displays[0]], [source("")])).toHaveLength(1)
    expect(() => matchCaptureSources(displays, [source("7")])).toThrowError(
      "unsupported_multi_display",
    )
  })

  it("captures all displays with one backend call and actual image sizes", async () => {
    const getSources = vi.fn().mockResolvedValue([source("9", 1920, 1080), source("7", 2880, 1800)])
    const backend = new ElectronDesktopCapturerBackend({
      getPermissionStatus: () => "granted",
      getSources,
      platform: "win32",
    })
    const captures = await backend.capture(displays)
    expect(getSources).toHaveBeenCalledOnce()
    expect(captures.map((capture) => capture.display.imageWidth)).toEqual([2880, 1920])
  })

  it("returns stable permission and timeout failures", async () => {
    const denied = new ElectronDesktopCapturerBackend({
      getPermissionStatus: () => "denied",
      getSources: vi.fn(),
      platform: "darwin",
    })
    await expect(denied.capture([displays[0]])).rejects.toMatchObject({
      code: "permission_denied",
    })

    const timedOut = new ElectronDesktopCapturerBackend({
      getPermissionStatus: () => "granted",
      getSources: () => new Promise(() => undefined),
      platform: "linux",
      timeoutMs: 5,
    })
    await expect(timedOut.capture([displays[0]])).rejects.toMatchObject({
      code: "capture_timeout",
    })
  })

  it("zeros already encoded displays when a later display fails", async () => {
    const firstPng = Buffer.from([1, 2, 3, 4])
    const backend = new ElectronDesktopCapturerBackend({
      getPermissionStatus: () => "granted",
      getSources: vi.fn().mockResolvedValue([source("7", 200, 100, firstPng), source("9", 0, 0)]),
      platform: "win32",
    })

    await expect(backend.capture(displays)).rejects.toMatchObject({
      code: "capture_unavailable",
    })
    expect(firstPng.every((byte) => byte === 0)).toBe(true)
  })
})
