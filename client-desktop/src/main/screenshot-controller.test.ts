import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BrowserWindow, IpcMainInvokeEvent } from "electron"
import type { CaptureBackend, CapturedDisplay } from "@main/screenshot-backend"
import { IPC } from "@shared/bridge"

const electronMocks = vi.hoisted(() => {
  let nextWindowId = 10
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const protocolHandlers = new Map<string, (request: Request) => Promise<Response>>()
  const windows: Array<ReturnType<typeof createWindow>> = []

  function createWindow() {
    const windowHandlers = new Map<string, (...args: unknown[]) => void>()
    const webContentsHandlers = new Map<string, (...args: unknown[]) => void>()
    const webContents = {
      focus: vi.fn(),
      id: nextWindowId++,
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) =>
        webContentsHandlers.set(event, listener),
      ),
      setWindowOpenHandler: vi.fn(),
    }
    return {
      destroy: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) =>
        windowHandlers.set(event, listener),
      ),
      removeMenu: vi.fn(),
      setBounds: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      show: vi.fn(),
      webContents,
      webContentsHandlers,
      windowHandlers,
    }
  }

  return {
    browserWindow: vi.fn(function BrowserWindowMock() {
      const window = createWindow()
      windows.push(window)
      return window
    }),
    clipboardWriteImage: vi.fn(),
    createFromBuffer: vi.fn(() => ({
      getSize: () => ({ height: 60, width: 70 }),
      isEmpty: (): boolean => false,
    })),
    getAllDisplays: vi.fn(),
    handlers,
    protocolHandle: vi.fn((scheme: string, handler: (request: Request) => Promise<Response>) =>
      protocolHandlers.set(scheme, handler),
    ),
    protocolHandlers,
    showSaveDialog: vi.fn(),
    windows,
  }
})

vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: electronMocks.browserWindow,
  clipboard: { writeImage: electronMocks.clipboardWriteImage },
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => electronMocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => electronMocks.handlers.delete(channel),
  },
  nativeImage: { createFromBuffer: electronMocks.createFromBuffer },
  protocol: {
    handle: electronMocks.protocolHandle,
    unhandle: vi.fn(),
  },
  screen: {
    getAllDisplays: electronMocks.getAllDisplays,
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => ({ id: 7 }),
  },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
}))

import { ScreenshotController } from "@main/screenshot-controller"

const pngSignature = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 70, 0, 0, 0, 60, 8, 6, 0,
  0, 0, 0, 0, 0, 0,
]
const conversationId = "550e8400-e29b-41d4-a716-446655440000"

describe("ScreenshotController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.handlers.clear()
    electronMocks.protocolHandlers.clear()
    electronMocks.windows.length = 0
    electronMocks.getAllDisplays.mockReturnValue([display()])
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: true })
  })

  it("只允许主窗口启动，并拒绝未注册浮层读取会话", async () => {
    const { controller } = createController()
    controller.registerIpc()

    await expect(invoke(IPC.screenshotStart, 99, {})).rejects.toThrow("截图启动来源无效")

    await expect(invoke(IPC.screenshotStart, 1, {})).resolves.toMatchObject({ status: "started" })
    await expect(invoke(IPC.screenshotMetadata, 999)).rejects.toThrow("截图会话无效或已过期")
    await expect(
      invoke(IPC.screenshotMetadata, electronMocks.windows[0].webContents.id),
    ).resolves.toMatchObject({ defaultOutput: "copy" })
  })

  it("Windows 截图浮层使用完整屏幕边界覆盖任务栏，避免压缩整屏图像", async () => {
    const { controller } = createController(capturedDisplay(), undefined, "win32")

    await expect(controller.start({})).resolves.toMatchObject({ status: "started" })

    expect(electronMocks.browserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        fullscreenable: false,
        height: 900,
        thickFrame: false,
        type: undefined,
        width: 1440,
        x: 0,
        y: 0,
      }),
    )
    expect(electronMocks.windows[0].setBounds).toHaveBeenCalledWith(
      { height: 900, width: 1440, x: 0, y: 0 },
      false,
    )
    expect(electronMocks.windows[0].show.mock.invocationCallOrder[0]).toBeLessThan(
      electronMocks.windows[0].setBounds.mock.invocationCallOrder[0],
    )
    expect(electronMocks.windows[0].setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
  })

  it("Windows 多显示器浮层显示后保留各自的完整屏幕边界", async () => {
    const primary = display()
    const secondary = display(9, { height: 1080, width: 1920, x: -1920, y: -120 })
    const captures = [capturedDisplay("7", primary.bounds), capturedDisplay("9", secondary.bounds)]
    electronMocks.getAllDisplays.mockReturnValue([primary, secondary])
    const backend: CaptureBackend = { capture: vi.fn().mockResolvedValue(captures) }
    const { controller } = createController(captures[0], backend, "win32")

    await expect(controller.start({})).resolves.toMatchObject({ status: "started" })

    expect(electronMocks.browserWindow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ height: 900, width: 1440, x: 0, y: 0 }),
    )
    expect(electronMocks.browserWindow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ height: 1080, width: 1920, x: -1920, y: -120 }),
    )
    expect(electronMocks.windows[0].setBounds).toHaveBeenCalledWith(primary.bounds, false)
    expect(electronMocks.windows[1].setBounds).toHaveBeenCalledWith(secondary.bounds, false)
  })

  it("所有截图 IPC 都拒绝不可信来源", async () => {
    const { controller } = createController()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, {})
    const senderId = electronMocks.windows[0].webContents.id

    for (const url of ["https://evil.example/", "http://192.168.1.2:20050/"]) {
      for (const channel of [
        IPC.screenshotStart,
        IPC.screenshotMetadata,
        IPC.screenshotCancel,
        IPC.screenshotResultStart,
        IPC.screenshotResultChunk,
        IPC.screenshotResultFinish,
      ]) {
        await expect(invokeFrom(channel, senderId, url)).rejects.toThrow("IPC 调用来源不受信任")
      }
    }
  })

  it("开发环境允许 localhost 主窗口启动截图", async () => {
    const { controller } = createController()
    controller.registerIpc()

    await expect(
      invokeFrom(IPC.screenshotStart, 1, "http://localhost:20050/", {}),
    ).resolves.toMatchObject({ status: "started" })
  })

  it("拒绝非 UUID 对话标识，并规范化有效 UUID", async () => {
    const { controller, onConversationResult } = createController()
    controller.registerIpc()

    await expect(
      invoke(IPC.screenshotStart, 1, { conversationId: "conversation-1" }),
    ).rejects.toThrow("截图对话标识无效")
    expect(electronMocks.windows).toHaveLength(0)

    await invoke(IPC.screenshotStart, 1, {
      conversationId: `  ${conversationId.toUpperCase()}  `,
    })
    const senderId = electronMocks.windows[0].webContents.id
    await submitPng(senderId, "conversation")
    await invoke(IPC.screenshotResultFinish, senderId)

    expect(onConversationResult).toHaveBeenCalledWith(expect.objectContaining({ conversationId }))
  })

  it("乱序结果会清除组装状态，并允许重新提交", async () => {
    const { controller } = createController()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, {})
    const senderId = electronMocks.windows[0].webContents.id

    await invoke(IPC.screenshotResultStart, senderId, {
      action: "copy",
      totalBytes: pngSignature.length,
      totalChunks: 1,
    })
    await expect(
      invoke(IPC.screenshotResultChunk, senderId, 1, new Uint8Array(pngSignature)),
    ).rejects.toThrow("截图结果分块顺序无效")
    await expect(
      invoke(IPC.screenshotResultStart, senderId, {
        action: "copy",
        totalBytes: pngSignature.length,
        totalChunks: 1,
      }),
    ).resolves.toBeUndefined()
  })

  it("采集完成前取消会使结果失效且不创建浮层", async () => {
    let resolveCapture!: (captures: ReadonlyArray<CapturedDisplay>) => void
    const capture = capturedDisplay()
    const backend: CaptureBackend = {
      capture: vi.fn(
        () =>
          new Promise<ReadonlyArray<CapturedDisplay>>((resolve) => {
            resolveCapture = resolve
          }),
      ),
    }
    const { controller } = createController(capture, backend)

    const started = controller.start({})
    controller.cancelActive()
    resolveCapture([capture])

    await expect(started).resolves.toEqual({ code: "capture_failed", status: "error" })
    expect(electronMocks.windows).toHaveLength(0)
    expect(capture.png.every((byte) => byte === 0)).toBe(true)
  })

  it("取消保存后保留浮层和编辑状态，可再次输出", async () => {
    const { controller } = createController()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, {})
    const overlay = electronMocks.windows[0]
    const senderId = overlay.webContents.id

    await submitPng(senderId, "save")

    await expect(invoke(IPC.screenshotResultFinish, senderId)).resolves.toEqual({
      status: "save-canceled",
    })
    expect(overlay.destroy).not.toHaveBeenCalled()
    await expect(
      invoke(IPC.screenshotResultStart, senderId, {
        action: "copy",
        totalBytes: pngSignature.length,
        totalChunks: 1,
      }),
    ).resolves.toBeUndefined()
  })

  it("输出失败后清除旧组装状态并允许重试", async () => {
    const { controller } = createController()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, {})
    const senderId = electronMocks.windows[0].webContents.id
    electronMocks.clipboardWriteImage.mockImplementationOnce(() => {
      throw new Error("clipboard unavailable")
    })

    await submitPng(senderId, "copy")
    await expect(invoke(IPC.screenshotResultFinish, senderId)).rejects.toThrow(
      "clipboard unavailable",
    )
    await expect(
      invoke(IPC.screenshotResultStart, senderId, {
        action: "copy",
        totalBytes: pngSignature.length,
        totalChunks: 1,
      }),
    ).resolves.toBeUndefined()
  })

  it("所有输出动作都拒绝无法解码的伪 PNG", async () => {
    const { controller } = createController()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, {})
    const senderId = electronMocks.windows[0].webContents.id
    electronMocks.createFromBuffer.mockReturnValueOnce({
      getSize: () => ({ height: 0, width: 0 }),
      isEmpty: () => true,
    })

    await submitPng(senderId, "save")
    await expect(invoke(IPC.screenshotResultFinish, senderId)).rejects.toThrow("截图结果无法读取")
    expect(electronMocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it("在交给 nativeImage 解码前拒绝超过屏幕尺寸的 PNG", async () => {
    const { controller } = createController()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, {})
    const senderId = electronMocks.windows[0].webContents.id
    const oversizedPng = Uint8Array.from(pngSignature)
    new DataView(oversizedPng.buffer).setUint32(16, 2881)

    await invoke(IPC.screenshotResultStart, senderId, {
      action: "copy",
      totalBytes: oversizedPng.byteLength,
      totalChunks: 1,
    })
    await invoke(IPC.screenshotResultChunk, senderId, 0, oversizedPng)
    await expect(invoke(IPC.screenshotResultFinish, senderId)).rejects.toThrow("截图结果无法读取")

    expect(electronMocks.createFromBuffer).not.toHaveBeenCalled()
  })

  it("为对话发布一次性 PNG 资源", async () => {
    const { controller, onConversationResult } = createController()
    controller.installProtocol()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, { conversationId })
    const senderId = electronMocks.windows[0].webContents.id

    await submitPng(senderId, "conversation")
    await expect(invoke(IPC.screenshotResultFinish, senderId)).resolves.toEqual({
      status: "completed",
    })

    expect(onConversationResult).toHaveBeenCalledWith(expect.objectContaining({ conversationId }))
    const resourceUrl = onConversationResult.mock.calls[0][0].resourceUrl
    const protocolHandler = electronMocks.protocolHandlers.get("magicchat-capture")
    expect(protocolHandler).toBeDefined()
    const first = await protocolHandler!(new Request(resourceUrl))
    const second = await protocolHandler!(new Request(resourceUrl))
    expect(first.status).toBe(200)
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array(pngSignature))
    expect(second.status).toBe(404)
  })

  it("控制器销毁时清零未消费的结果资源", async () => {
    const { controller } = createController()
    controller.installProtocol()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, { conversationId })
    const senderId = electronMocks.windows[0].webContents.id
    await submitPng(senderId, "conversation")
    await invoke(IPC.screenshotResultFinish, senderId)
    const resources = (
      controller as unknown as {
        resultResources: Map<string, { buffer: Buffer }>
      }
    ).resultResources
    const resourceBuffer = [...resources.values()][0].buffer

    controller.dispose()

    expect(resources.size).toBe(0)
    expect(resourceBuffer.every((byte) => byte === 0)).toBe(true)
  })

  it("取消会话时销毁全部浮层并清零原始截图", async () => {
    const capture = capturedDisplay()
    const { controller } = createController(capture)
    await controller.start({})

    controller.cancelActive()

    expect(electronMocks.windows[0].destroy).toHaveBeenCalledOnce()
    expect(capture.png.every((byte) => byte === 0)).toBe(true)
  })

  it("取消旧会话的延迟清理不会销毁新会话", async () => {
    const { controller } = createController()
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, {})
    const firstSenderId = electronMocks.windows[0].webContents.id

    await invoke(IPC.screenshotCancel, firstSenderId)
    controller.cancelActive()
    await controller.start({})

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(electronMocks.windows[1].destroy).not.toHaveBeenCalled()
    controller.dispose()
  })

  it("保存输出进行期间拒绝其他显示器浮层提交结果", async () => {
    electronMocks.getAllDisplays.mockReturnValue([display(), display(9)])
    const firstCapture = capturedDisplay()
    const secondCapture = capturedDisplay("9")
    const backend: CaptureBackend = {
      capture: vi.fn().mockResolvedValue([firstCapture, secondCapture]),
    }
    const { controller } = createController(firstCapture, backend)
    controller.registerIpc()
    await invoke(IPC.screenshotStart, 1, {})
    const firstSenderId = electronMocks.windows[0].webContents.id
    const secondSenderId = electronMocks.windows[1].webContents.id
    let resolveSave!: (result: { canceled: boolean; filePath?: string }) => void
    electronMocks.showSaveDialog.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )

    await submitPng(firstSenderId, "save")
    const finishing = invoke(IPC.screenshotResultFinish, firstSenderId)
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(
      invoke(IPC.screenshotResultStart, secondSenderId, {
        action: "copy",
        totalBytes: pngSignature.length,
        totalChunks: 1,
      }),
    ).rejects.toThrow("已有截图输出正在处理")

    resolveSave({ canceled: true })
    await expect(finishing).resolves.toEqual({ status: "save-canceled" })
    controller.dispose()
  })
})

function createController(
  capture = capturedDisplay(),
  backend: CaptureBackend | undefined = undefined,
  platform: NodeJS.Platform = "darwin",
) {
  const onConversationResult = vi.fn()
  const mainWindow = { webContents: { id: 1 } } as BrowserWindow
  const controller = new ScreenshotController({
    backend: backend ?? { capture: vi.fn().mockResolvedValue([capture]) },
    capturePreloadPath: "/preload.cjs",
    captureUrl: "magicchat-app://app/capture.html",
    getMainWindow: () => mainWindow,
    onConversationResult,
    platform,
  })
  return { controller, onConversationResult }
}

function display(id = 7, bounds = { height: 900, width: 1440, x: 0, y: 0 }) {
  return {
    bounds,
    id,
    scaleFactor: 2,
  }
}

function capturedDisplay(id = "7", bounds = display().bounds): CapturedDisplay {
  return {
    display: {
      bounds,
      id,
      imageHeight: bounds.height * 2,
      imageWidth: bounds.width * 2,
      scaleFactor: 2,
    },
    png: Buffer.from(pngSignature),
  }
}

async function invoke(channel: string, senderId: number, ...args: unknown[]) {
  return invokeFrom(channel, senderId, "magicchat-app://app/index.html", ...args)
}

async function invokeFrom(channel: string, senderId: number, url: string, ...args: unknown[]) {
  const handler = electronMocks.handlers.get(channel)
  if (!handler) throw new Error(`IPC handler missing: ${channel}`)
  return handler({ sender: { id: senderId }, senderFrame: { url } } as IpcMainInvokeEvent, ...args)
}

async function submitPng(senderId: number, action: "conversation" | "copy" | "save") {
  await invoke(IPC.screenshotResultStart, senderId, {
    action,
    totalBytes: pngSignature.length,
    totalChunks: 1,
  })
  await invoke(IPC.screenshotResultChunk, senderId, 0, new Uint8Array(pngSignature))
}
