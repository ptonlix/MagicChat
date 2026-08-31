// @vitest-environment node

import { createHash } from "node:crypto"
import { access, mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { VersionJsonUpdater } from "@main/version-json-updater"

describe("VersionJsonUpdater", () => {
  it("从 version.json 发现新版本并直接下载全量安装包", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-version-updater-"))
    const installer = Buffer.alloc(1024, 0x5a)
    installer[0] = 0x4d
    installer[1] = 0x5a
    const packageUrl =
      "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.2.0/Jiying-1.2.0-win-x64.exe"
    const manifest = {
      windows: {
        build: 12,
        sha512: createHash("sha512").update(installer).digest("base64"),
        size: installer.byteLength,
        url: packageUrl,
        version: "1.2.0",
      },
    }
    const requested: string[] = []
    const installPackage = vi.fn<(filePath: string) => Promise<void>>().mockResolvedValue(undefined)
    const updater = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentVersion: "1.1.0",
      fetcher: async (url) => {
        requested.push(url)
        return url.startsWith("https://jiying.chat/releases/version.json?")
          ? new Response(JSON.stringify(manifest), {
              headers: { "content-type": "application/json" },
              status: 200,
            })
          : new Response(installer, {
              headers: { "content-length": String(installer.byteLength) },
              status: 200,
            })
      },
      installPackage,
      platform: "win32",
    })
    const events: string[] = []
    updater.on("update-available", () => events.push("available"))
    updater.on("update-downloaded", () => events.push("downloaded"))

    await updater.checkForUpdates()
    await updater.downloadUpdate()
    await updater.installUpdate()

    expect(events).toEqual(["available", "downloaded"])
    expect(requested).toHaveLength(2)
    expect(requested[1]).toBe(packageUrl)
    expect(requested.every((url) => !url.endsWith(".blockmap"))).toBe(true)
    const downloadedPath = installPackage.mock.calls[0][0]
    expect(path.basename(downloadedPath)).toBe("Jiying-1.2.0.exe")
    await expect(access(downloadedPath)).resolves.toBeUndefined()
    await updater.discardDownloadedUpdate()
    await expect(access(downloadedPath)).rejects.toThrow()
  })

  it("同版本不下载，Windows ARM64 不会误用 x64 字段", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-version-current-"))
    const response = () =>
      new Response(
        JSON.stringify({
          windows: { build: 1, version: "1.1.0", url: "https://example.com/MagicChat.exe" },
        }),
        { status: 200 },
      )
    const current = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentVersion: "1.1.0",
      fetcher: async () => response(),
      installPackage: async () => undefined,
      platform: "win32",
    })
    const unavailable = vi.fn()
    current.on("update-not-available", unavailable)
    await current.checkForUpdates()
    expect(unavailable).toHaveBeenCalledOnce()
    await expect(current.downloadUpdate()).rejects.toThrow("available")

    const arm = new VersionJsonUpdater({
      arch: "arm64",
      cacheDirectory: directory,
      currentVersion: "1.0.0",
      fetcher: async () => response(),
      installPackage: async () => undefined,
      platform: "win32",
    })
    await expect(arm.checkForUpdates()).rejects.toThrow("architecture")
  })
})
