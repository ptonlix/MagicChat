import { randomBytes, randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  screen,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
} from "electron"
import { assertTrustedIpcSender } from "@main/ipc-security"
import {
  ElectronDesktopCapturerBackend,
  ScreenshotCaptureError,
  type CaptureBackend,
  type CapturedDisplay,
} from "@main/screenshot-backend"
import { IPC } from "@shared/bridge"
import {
  SCREENSHOT_LIMITS,
  type CaptureResultFinish,
  type CaptureResultStart,
  type CaptureSessionMetadata,
  type ScreenshotConversationResult,
  type ScreenshotOutputAction,
  type ScreenshotStartInput,
  type ScreenshotStartResult,
} from "@shared/screenshot-contract"

type Overlay = {
  capture: CapturedDisplay
  token: string
  window: BrowserWindow
}

type ResultAssembly = {
  action: ScreenshotOutputAction
  chunks: Buffer[]
  nextIndex: number
  receivedBytes: number
  senderId: number
  totalBytes: number
  totalChunks: number
}

type ActiveSession = {
  assembly?: ResultAssembly
  conversationId?: string
  defaultOutput: ScreenshotOutputAction
  disposing: boolean
  id: string
  overlays: Overlay[]
  outputInProgress?: number
  timer: ReturnType<typeof setTimeout>
}

type ResultResource = {
  buffer: Buffer
  sessionId: string
  timer: ReturnType<typeof setTimeout>
}

type ScreenshotControllerOptions = Readonly<{
  backend?: CaptureBackend
  capturePreloadPath: string
  captureUrl: string
  getMainWindow: () => BrowserWindow | undefined
  onConversationResult: (result: ScreenshotConversationResult) => void
}>

export class ScreenshotController {
  private readonly backend: CaptureBackend
  private active?: ActiveSession
  private disposed = false
  private lifecycleVersion = 0
  private starting?: Readonly<{
    promise: Promise<ScreenshotStartResult>
    version: number
  }>
  private readonly resultResources = new Map<string, ResultResource>()
  private protocolInstalled = false

  constructor(private readonly options: ScreenshotControllerOptions) {
    this.backend = options.backend ?? new ElectronDesktopCapturerBackend()
  }

  installProtocol(): void {
    if (this.protocolInstalled) return
    protocol.handle("magicchat-capture", (request) => this.handleResourceRequest(request))
    this.protocolInstalled = true
  }

  registerIpc(): () => void {
    const register = (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => ipcMain.handle(channel, handler)

    register(IPC.screenshotStart, (event, input) => {
      assertTrustedIpcSender(event)
      this.assertMainSender(event)
      return this.start(parseStartInput(input))
    })
    register(IPC.screenshotMetadata, (event) => this.metadata(event.sender.id))
    register(IPC.screenshotCancel, (event) => this.cancelFrom(event.sender.id))
    register(IPC.screenshotResultStart, (event, input) =>
      this.startResult(event.sender.id, parseResultStart(input)),
    )
    register(IPC.screenshotResultChunk, (event, index, bytes) =>
      this.addResultChunk(event.sender.id, parseIndex(index), parseBytes(bytes)),
    )
    register(IPC.screenshotResultFinish, (event) => this.finishResult(event.sender.id))

    return () => {
      for (const channel of [
        IPC.screenshotStart,
        IPC.screenshotMetadata,
        IPC.screenshotCancel,
        IPC.screenshotResultStart,
        IPC.screenshotResultChunk,
        IPC.screenshotResultFinish,
      ])
        ipcMain.removeHandler(channel)
    }
  }

  async start(input: ScreenshotStartInput): Promise<ScreenshotStartResult> {
    if (this.disposed) return { code: "capture_failed", status: "error" }
    if (this.active) {
      this.focusActiveOverlay()
      return { sessionId: this.active.id, status: "focused" }
    }
    if (this.starting) return this.starting.promise
    const version = this.lifecycleVersion
    const promise = this.createSession(input, version)
    this.starting = { promise, version }
    try {
      return await promise
    } finally {
      if (this.starting?.promise === promise) this.starting = undefined
    }
  }

  cancelActive(): void {
    this.lifecycleVersion += 1
    this.starting = undefined
    this.disposeActive()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifecycleVersion += 1
    this.starting = undefined
    this.disposeActive()
    for (const token of [...this.resultResources.keys()]) this.deleteResultResource(token)
    if (this.protocolInstalled) {
      void protocol.unhandle("magicchat-capture")
      this.protocolInstalled = false
    }
  }

  private async createSession(
    input: ScreenshotStartInput,
    version: number,
  ): Promise<ScreenshotStartResult> {
    let captures: ReadonlyArray<CapturedDisplay> = []
    const overlays: Overlay[] = []
    let sessionId: string | undefined
    try {
      captures = await this.backend.capture(screen.getAllDisplays())
      if (this.disposed || version !== this.lifecycleVersion)
        throw new ScreenshotCaptureError("capture_failed")
      if (this.active) {
        zeroCaptures(captures)
        this.focusActiveOverlay()
        return { sessionId: this.active.id, status: "focused" }
      }
      const currentSessionId = randomUUID()
      sessionId = currentSessionId
      const defaultOutput = input.conversationId ? "conversation" : "copy"
      for (const capture of captures) overlays.push(this.createOverlay(currentSessionId, capture))
      const session: ActiveSession = {
        conversationId: input.conversationId,
        defaultOutput,
        disposing: false,
        id: currentSessionId,
        overlays,
        timer: setTimeout(
          () => this.disposeSession(currentSessionId),
          SCREENSHOT_LIMITS.maxSessionMs,
        ),
      }
      this.active = session
      await Promise.all(overlays.map((overlay) => overlay.window.loadURL(this.options.captureUrl)))
      if (this.active?.id !== currentSessionId) throw new ScreenshotCaptureError("capture_failed")
      for (const overlay of overlays) overlay.window.show()
      this.focusActiveOverlay()
      return { sessionId: currentSessionId, status: "started" }
    } catch (error) {
      if (sessionId && this.active?.id === sessionId) this.disposeActive()
      else cleanupCaptureAttempt(captures, overlays)
      return {
        code: error instanceof ScreenshotCaptureError ? error.code : "capture_failed",
        status: "error",
      }
    }
  }

  private createOverlay(sessionId: string, capture: CapturedDisplay): Overlay {
    const bounds = capture.display.bounds
    const window = new BrowserWindow({
      acceptFirstMouse: true,
      alwaysOnTop: true,
      backgroundColor: "#000000",
      frame: false,
      fullscreenable: false,
      hasShadow: false,
      height: Math.round(bounds.height),
      maximizable: false,
      minimizable: false,
      movable: false,
      resizable: false,
      roundedCorners: false,
      show: false,
      skipTaskbar: true,
      title: "即应截图",
      type: overlayWindowType(process.platform),
      webPreferences: {
        additionalArguments: ["--magicchat-capture"],
        backgroundThrottling: false,
        contextIsolation: true,
        devTools: !app.isPackaged,
        nodeIntegration: false,
        preload: this.options.capturePreloadPath,
        sandbox: true,
        webSecurity: true,
      },
      width: Math.round(bounds.width),
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
    })
    window.removeMenu()
    window.setAlwaysOnTop(true, "screen-saver")
    if (process.platform !== "win32")
      window.setVisibleOnAllWorkspaces(true, {
        skipTransformProcessType: true,
        visibleOnFullScreen: true,
      })
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event) => event.preventDefault())
    window.webContents.on("render-process-gone", () => this.disposeSession(sessionId))
    window.on("closed", () => {
      if (!this.active?.disposing) this.disposeSession(sessionId)
    })
    return { capture, token: secureToken(), window }
  }

  private metadata(senderId: number): CaptureSessionMetadata {
    const { overlay, session } = this.requireOverlay(senderId)
    return {
      defaultOutput: session.defaultOutput,
      display: overlay.capture.display,
      sessionId: session.id,
      sourceUrl: `magicchat-capture://source/${encodeURIComponent(session.id)}/${overlay.token}`,
    }
  }

  private cancelFrom(senderId: number): void {
    const { session } = this.requireOverlay(senderId)
    setTimeout(() => this.disposeSession(session.id), 0)
  }

  private startResult(senderId: number, input: CaptureResultStart): void {
    const { session } = this.requireOverlay(senderId)
    if (session.outputInProgress !== undefined) throw new Error("已有截图输出正在处理")
    if (session.assembly) throw new Error("已有截图结果正在传输")
    if (input.action === "conversation" && !session.conversationId)
      throw new Error("当前截图会话不属于对话")
    session.assembly = {
      action: input.action,
      chunks: [],
      nextIndex: 0,
      receivedBytes: 0,
      senderId,
      totalBytes: input.totalBytes,
      totalChunks: input.totalChunks,
    }
  }

  private addResultChunk(senderId: number, index: number, bytes: Uint8Array): void {
    const { session } = this.requireOverlay(senderId)
    const assembly = session.assembly
    if (!assembly) throw new Error("截图结果分块顺序无效")
    if (assembly.senderId !== senderId || index !== assembly.nextIndex) {
      this.clearAssembly(session)
      throw new Error("截图结果分块顺序无效")
    }
    if (bytes.byteLength === 0 || bytes.byteLength > SCREENSHOT_LIMITS.chunkBytes) {
      this.clearAssembly(session)
      throw new Error("截图结果分块大小无效")
    }
    assembly.receivedBytes += bytes.byteLength
    if (assembly.receivedBytes > assembly.totalBytes) {
      this.clearAssembly(session)
      throw new Error("截图结果超出声明大小")
    }
    assembly.chunks.push(Buffer.from(bytes))
    assembly.nextIndex += 1
  }

  private async finishResult(senderId: number): Promise<CaptureResultFinish> {
    const { overlay, session } = this.requireOverlay(senderId)
    const assembly = session.assembly
    if (
      !assembly ||
      assembly.senderId !== senderId ||
      assembly.nextIndex !== assembly.totalChunks ||
      assembly.receivedBytes !== assembly.totalBytes
    ) {
      this.clearAssembly(session)
      throw new Error("截图结果不完整")
    }
    const png = Buffer.concat(assembly.chunks, assembly.totalBytes)
    this.clearAssembly(session)
    if (session.outputInProgress !== undefined) {
      png.fill(0)
      throw new Error("已有截图输出正在处理")
    }
    session.outputInProgress = senderId
    let retainedAsResource = false
    let completed = false
    try {
      if (!isPng(png)) throw new Error("截图结果不是有效 PNG")
      const pngDimensions = readPngDimensions(png)
      if (
        !pngDimensions ||
        !validResultDimension(pngDimensions.width, overlay.capture.display.imageWidth) ||
        !validResultDimension(pngDimensions.height, overlay.capture.display.imageHeight)
      )
        throw new Error("截图结果无法读取")
      const image = nativeImage.createFromBuffer(png)
      const imageSize = image.getSize()
      if (
        image.isEmpty() ||
        !validResultDimension(imageSize.width, overlay.capture.display.imageWidth) ||
        !validResultDimension(imageSize.height, overlay.capture.display.imageHeight)
      )
        throw new Error("截图结果无法读取")

      if (assembly.action === "save") {
        const result = await dialog.showSaveDialog(overlay.window, {
          defaultPath: `MagicChat-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
          filters: [{ extensions: ["png"], name: "PNG 图片" }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        })
        if (result.canceled || !result.filePath) return { status: "save-canceled" }
        await writeFile(result.filePath, png)
      } else if (assembly.action === "copy") {
        clipboard.writeImage(image)
      } else {
        const conversationId = session.conversationId
        if (!conversationId) throw new Error("当前截图会话不属于对话")
        const token = secureToken()
        const timer = setTimeout(
          () => this.deleteResultResource(token),
          SCREENSHOT_LIMITS.resourceTtlMs,
        )
        this.resultResources.set(token, { buffer: png, sessionId: session.id, timer })
        try {
          this.options.onConversationResult({
            conversationId,
            fileName: `MagicChat-${Date.now()}.png`,
            resourceUrl: `magicchat-capture://result/${encodeURIComponent(session.id)}/${token}`,
            sessionId: session.id,
          })
          retainedAsResource = true
        } catch (error) {
          this.deleteResultResource(token)
          throw error
        }
      }

      setTimeout(() => this.disposeSession(session.id), 0)
      completed = true
      return { status: "completed" }
    } finally {
      if (!completed) session.outputInProgress = undefined
      if (!retainedAsResource) png.fill(0)
    }
  }

  private async handleResourceRequest(request: Request): Promise<Response> {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 })
    try {
      const url = new URL(request.url)
      const [sessionId, token] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
      if (!sessionId || !token) return new Response("Not found", { status: 404 })
      if (url.hostname === "source") {
        const session = this.active
        const overlay = session?.overlays.find(
          (candidate) => candidate.token === token && session.id === sessionId,
        )
        if (!overlay) return new Response("Not found", { status: 404 })
        return pngResponse(overlay.capture.png)
      }
      if (url.hostname === "result") {
        const resource = this.resultResources.get(token)
        if (!resource || resource.sessionId !== sessionId)
          return new Response("Not found", { status: 404 })
        const buffer = Buffer.from(resource.buffer)
        this.deleteResultResource(token)
        return pngResponse(buffer)
      }
      return new Response("Not found", { status: 404 })
    } catch {
      return new Response("Not found", { status: 404 })
    }
  }

  private requireOverlay(senderId: number): { overlay: Overlay; session: ActiveSession } {
    const session = this.active
    const overlay = session?.overlays.find(
      (candidate) => candidate.window.webContents.id === senderId,
    )
    if (!session || session.disposing || !overlay) throw new Error("截图会话无效或已过期")
    return { overlay, session }
  }

  private assertMainSender(event: IpcMainInvokeEvent): void {
    if (event.sender.id !== this.options.getMainWindow()?.webContents.id)
      throw new Error("截图启动来源无效")
  }

  private focusActiveOverlay(): void {
    const session = this.active
    if (!session) return
    const point = screen.getCursorScreenPoint()
    const displayId = String(screen.getDisplayNearestPoint(point).id)
    const overlay =
      session.overlays.find((candidate) => candidate.capture.display.id === displayId) ??
      session.overlays[0]
    if (!overlay || overlay.window.isDestroyed()) return
    overlay.window.show()
    overlay.window.focus()
  }

  private disposeSession(sessionId: string): void {
    if (this.active?.id === sessionId) this.disposeActive()
  }

  private disposeActive(): void {
    const session = this.active
    if (!session) return
    session.disposing = true
    this.active = undefined
    clearTimeout(session.timer)
    this.clearAssembly(session)
    for (const overlay of session.overlays) {
      overlay.capture.png.fill(0)
      if (!overlay.window.isDestroyed()) overlay.window.destroy()
    }
  }

  private deleteResultResource(token: string): void {
    const resource = this.resultResources.get(token)
    if (!resource) return
    clearTimeout(resource.timer)
    resource.buffer.fill(0)
    this.resultResources.delete(token)
  }

  private clearAssembly(session: ActiveSession): void {
    const assembly = session.assembly
    if (!assembly) return
    for (const chunk of assembly.chunks) chunk.fill(0)
    session.assembly = undefined
  }
}

function overlayWindowType(platform: NodeJS.Platform): BrowserWindowConstructorOptions["type"] {
  if (platform === "darwin") return "panel"
  if (platform === "win32") return "toolbar"
  return undefined
}

function parseStartInput(value: unknown): ScreenshotStartInput {
  if (!value || typeof value !== "object") return {}
  const conversationId = (value as { conversationId?: unknown }).conversationId
  if (conversationId === undefined) return {}
  if (
    typeof conversationId !== "string" ||
    conversationId.length === 0 ||
    conversationId.length > 256
  )
    throw new Error("截图对话标识无效")
  return { conversationId }
}

function parseResultStart(value: unknown): CaptureResultStart {
  if (!value || typeof value !== "object") throw new Error("截图结果元数据无效")
  const input = value as Record<string, unknown>
  if (!isOutputAction(input.action)) throw new Error("截图输出动作无效")
  const totalBytes = parseInteger(input.totalBytes, 1, SCREENSHOT_LIMITS.maxResultBytes)
  const totalChunks = parseInteger(
    input.totalChunks,
    1,
    Math.ceil(SCREENSHOT_LIMITS.maxResultBytes / SCREENSHOT_LIMITS.chunkBytes),
  )
  if (totalChunks !== Math.ceil(totalBytes / SCREENSHOT_LIMITS.chunkBytes))
    throw new Error("截图结果分块数量无效")
  return { action: input.action, totalBytes, totalChunks }
}

function parseIndex(value: unknown): number {
  return parseInteger(value, 0, 1_000)
}

function parseInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum)
    throw new Error("截图数值参数无效")
  return value as number
}

function parseBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("截图结果分块无效")
  return value
}

function isOutputAction(value: unknown): value is ScreenshotOutputAction {
  return value === "conversation" || value === "copy" || value === "save"
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
}

function readPngDimensions(
  buffer: Buffer,
): Readonly<{ height: number; width: number }> | undefined {
  if (buffer.byteLength < 33 || buffer.readUInt32BE(8) !== 13) return undefined
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return undefined
  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  }
}

function validResultDimension(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= maximum
}

function zeroCaptures(captures: ReadonlyArray<CapturedDisplay>): void {
  for (const capture of captures) capture.png.fill(0)
}

function cleanupCaptureAttempt(
  captures: ReadonlyArray<CapturedDisplay>,
  overlays: Overlay[],
): void {
  zeroCaptures(captures)
  for (const overlay of overlays) {
    if (!overlay.window.isDestroyed()) overlay.window.destroy()
  }
}

function secureToken(): string {
  return randomBytes(24).toString("hex")
}

function pngResponse(buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
