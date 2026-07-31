export const CAPTURE_BRIDGE_VERSION = 1 as const

export const SCREENSHOT_LIMITS = Object.freeze({
  captureTimeoutMs: 10_000,
  chunkBytes: 512 * 1024,
  maxDisplayCount: 8,
  maxImageBytes: 64 * 1024 * 1024,
  maxResultBytes: 48 * 1024 * 1024,
  maxSessionMs: 5 * 60_000,
  resourceTtlMs: 60_000,
})

export type ScreenshotErrorCode =
  | "capture_failed"
  | "capture_timeout"
  | "capture_unavailable"
  | "permission_denied"
  | "unsupported_multi_display"

export type ScreenshotOutputAction = "conversation" | "copy" | "save"

export type ScreenshotPoint = Readonly<{ x: number; y: number }>

export type ScreenshotRect = Readonly<{
  height: number
  width: number
  x: number
  y: number
}>

export type ScreenshotDisplay = Readonly<{
  bounds: ScreenshotRect
  id: string
  imageHeight: number
  imageWidth: number
  scaleFactor: number
}>

export type ScreenshotStartInput = Readonly<{
  conversationId?: string
}>

export type ScreenshotStartResult =
  | Readonly<{ sessionId: string; status: "focused" | "started" }>
  | Readonly<{ code: ScreenshotErrorCode; status: "error" }>

export type ScreenshotConversationResult = Readonly<{
  conversationId: string
  fileName: string
  resourceUrl: string
  sessionId: string
}>

export type CaptureSessionMetadata = Readonly<{
  defaultOutput: ScreenshotOutputAction
  display: ScreenshotDisplay
  sessionId: string
  sourceUrl: string
}>

export type CaptureResultStart = Readonly<{
  action: ScreenshotOutputAction
  totalBytes: number
  totalChunks: number
}>

export type CaptureResultFinish = Readonly<{
  status: "completed" | "save-canceled"
}>

export interface CaptureBridge {
  readonly version: typeof CAPTURE_BRIDGE_VERSION
  cancel(): Promise<void>
  getMetadata(): Promise<CaptureSessionMetadata>
  resultChunk(index: number, bytes: Uint8Array): Promise<void>
  resultFinish(): Promise<CaptureResultFinish>
  resultStart(input: CaptureResultStart): Promise<void>
}

export interface ScreenshotBridge {
  start(input: ScreenshotStartInput): Promise<ScreenshotStartResult>
  subscribeCompleted(listener: (result: ScreenshotConversationResult) => void): () => void
}
