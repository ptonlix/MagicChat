import { desktopCapturer, systemPreferences, type Display, type NativeImage } from "electron"
import {
  SCREENSHOT_LIMITS,
  type ScreenshotDisplay,
  type ScreenshotErrorCode,
} from "@shared/screenshot-contract"

type CaptureDisplay = Pick<Display, "bounds" | "id" | "scaleFactor">

type CaptureSource = Readonly<{
  display_id: string
  id: string
  thumbnail: Pick<NativeImage, "getSize" | "isEmpty" | "toPNG">
}>

export type CapturedDisplay = Readonly<{
  display: ScreenshotDisplay
  png: Buffer
}>

export interface CaptureBackend {
  capture(displays: ReadonlyArray<CaptureDisplay>): Promise<ReadonlyArray<CapturedDisplay>>
}

export class ScreenshotCaptureError extends Error {
  constructor(readonly code: ScreenshotErrorCode) {
    super(code)
    this.name = "ScreenshotCaptureError"
  }
}

type ElectronCaptureDependencies = Readonly<{
  getPermissionStatus: () => string
  getSources: (options: Electron.SourcesOptions) => Promise<ReadonlyArray<CaptureSource>>
  platform: NodeJS.Platform
  timeoutMs: number
}>

export class ElectronDesktopCapturerBackend implements CaptureBackend {
  private readonly dependencies: ElectronCaptureDependencies

  constructor(dependencies: Partial<ElectronCaptureDependencies> = {}) {
    this.dependencies = {
      getPermissionStatus: () =>
        process.platform === "darwin"
          ? systemPreferences.getMediaAccessStatus("screen")
          : "granted",
      getSources: (options) => desktopCapturer.getSources(options),
      platform: process.platform,
      timeoutMs: SCREENSHOT_LIMITS.captureTimeoutMs,
      ...dependencies,
    }
  }

  async capture(displays: ReadonlyArray<CaptureDisplay>): Promise<ReadonlyArray<CapturedDisplay>> {
    validateDisplays(displays)
    if (
      this.dependencies.platform === "darwin" &&
      ["denied", "restricted"].includes(this.dependencies.getPermissionStatus())
    )
      throw new ScreenshotCaptureError("permission_denied")

    const sources = await withTimeout(
      this.dependencies.getSources({
        fetchWindowIcons: false,
        thumbnailSize: captureThumbnailSize(displays),
        types: ["screen"],
      }),
      this.dependencies.timeoutMs,
    )
    const matched = matchCaptureSources(displays, sources)
    let totalBytes = 0
    const captures: CapturedDisplay[] = []
    try {
      for (const { display, source } of matched) {
        if (source.thumbnail.isEmpty()) throw new ScreenshotCaptureError("capture_unavailable")
        const size = source.thumbnail.getSize()
        if (!validDimension(size.width) || !validDimension(size.height))
          throw new ScreenshotCaptureError("capture_unavailable")
        const png = source.thumbnail.toPNG()
        totalBytes += png.byteLength
        if (
          png.byteLength === 0 ||
          png.byteLength > SCREENSHOT_LIMITS.maxImageBytes ||
          totalBytes > SCREENSHOT_LIMITS.maxImageBytes * displays.length
        ) {
          png.fill(0)
          throw new ScreenshotCaptureError("capture_unavailable")
        }
        captures.push({
          display: {
            bounds: { ...display.bounds },
            id: String(display.id),
            imageHeight: size.height,
            imageWidth: size.width,
            scaleFactor: display.scaleFactor,
          },
          png,
        })
      }
      return captures
    } catch (error) {
      zeroCaptures(captures)
      throw error
    }
  }
}

export function captureThumbnailSize(displays: ReadonlyArray<CaptureDisplay>): Electron.Size {
  validateDisplays(displays)
  let width = 1
  let height = 1
  for (const display of displays) {
    width = Math.max(width, Math.ceil(display.bounds.width * display.scaleFactor))
    height = Math.max(height, Math.ceil(display.bounds.height * display.scaleFactor))
  }
  return { height, width }
}

export function matchCaptureSources(
  displays: ReadonlyArray<CaptureDisplay>,
  sources: ReadonlyArray<CaptureSource>,
): ReadonlyArray<Readonly<{ display: CaptureDisplay; source: CaptureSource }>> {
  if (sources.length === 0) throw new ScreenshotCaptureError("capture_unavailable")
  if (displays.length === 1 && sources.length === 1)
    return [{ display: displays[0], source: sources[0] }]

  const byDisplayId = new Map<string, CaptureSource>()
  for (const source of sources) {
    if (!source.display_id || byDisplayId.has(source.display_id))
      throw new ScreenshotCaptureError("unsupported_multi_display")
    byDisplayId.set(source.display_id, source)
  }
  return displays.map((display) => {
    const source = byDisplayId.get(String(display.id))
    if (!source) throw new ScreenshotCaptureError("unsupported_multi_display")
    return { display, source }
  })
}

function validateDisplays(displays: ReadonlyArray<CaptureDisplay>): void {
  if (displays.length === 0 || displays.length > SCREENSHOT_LIMITS.maxDisplayCount)
    throw new ScreenshotCaptureError("capture_unavailable")
  for (const display of displays) {
    if (
      !validDimension(display.bounds.width) ||
      !validDimension(display.bounds.height) ||
      !Number.isFinite(display.scaleFactor) ||
      display.scaleFactor <= 0
    )
      throw new ScreenshotCaptureError("capture_unavailable")
  }
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 65_536
}

function zeroCaptures(captures: ReadonlyArray<CapturedDisplay>): void {
  for (const capture of captures) capture.png.fill(0)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ScreenshotCaptureError("capture_timeout")), timeoutMs)
      }),
    ])
  } catch (error) {
    if (error instanceof ScreenshotCaptureError) throw error
    throw new ScreenshotCaptureError("capture_failed")
  } finally {
    if (timer) clearTimeout(timer)
  }
}
