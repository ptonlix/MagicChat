import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { copyTemporaryImageToClipboard } from "@/lib/image-clipboard"

const { readTemporaryFileURLsMock, writeHostClipboardPngMock } = vi.hoisted(() => ({
  readTemporaryFileURLsMock: vi.fn(),
  writeHostClipboardPngMock: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()

  return {
    ...actual,
    readTemporaryFileURLs: readTemporaryFileURLsMock,
  }
})
vi.mock("@/lib/desktop-host", () => ({
  writeHostClipboardPng: writeHostClipboardPngMock,
}))

describe("copyTemporaryImageToClipboard", () => {
  beforeEach(() => {
    readTemporaryFileURLsMock.mockResolvedValue([
      {
        expiresAt: "2026-07-17T12:00:00Z",
        fileId: "file-1",
        url: "https://example.com/image.png",
      },
    ])
    writeHostClipboardPngMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("writes a temporary PNG image to the system clipboard", async () => {
    const imageBlob = new Blob(["image"], { type: "image/png" })
    const fetchMock = vi.fn().mockResolvedValue({
      blob: async () => imageBlob,
      ok: true,
      status: 200,
    } satisfies Pick<Response, "blob" | "ok" | "status">)
    vi.stubGlobal("fetch", fetchMock)

    await copyTemporaryImageToClipboard("file-1")

    expect(readTemporaryFileURLsMock).toHaveBeenCalledWith(["file-1"])
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/image.png")
    expect(writeHostClipboardPngMock).toHaveBeenCalledOnce()
    expect(writeHostClipboardPngMock.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array)
  })
})
