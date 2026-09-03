// @vitest-environment node

import type { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { access, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { installDesktopPackage } from "@main/desktop-package-installer"

describe("桌面全量包安装协调", () => {
  it("macOS 启动后台安装助手复制 DMG 中的 app 后退出应用", async () => {
    const calls: unknown[][] = []
    const spawnDetached = ((...args: unknown[]) => {
      calls.push(args)
      const child = new EventEmitter() as EventEmitter & { unref(): void }
      child.unref = vi.fn()
      queueMicrotask(() => child.emit("spawn"))
      return child
    }) as unknown as typeof spawn
    const quit = vi.fn()

    await installDesktopPackage({
      downloadedPath: "/tmp/MagicChat.dmg",
      openPath: async () => "",
      platform: "darwin",
      quit,
      runtimeExecutablePath: "/Applications/即应.app/Contents/MacOS/即应",
      runtimePid: 1234,
      spawnDetached,
    })

    expect(calls[0][0]).toBe("/bin/sh")
    expect(calls[0][1]).toEqual([
      "-c",
      expect.stringContaining('hdiutil attach "$dmg_path"'),
      "magicchat-macos-updater",
      "1234",
      "/tmp/MagicChat.dmg",
      "/Applications/即应.app",
    ])
    expect(calls[0][1]).toEqual([
      "-c",
      expect.stringContaining('ditto "$source_app" "$target_app"'),
      "magicchat-macos-updater",
      "1234",
      "/tmp/MagicChat.dmg",
      "/Applications/即应.app",
    ])
    expect(quit).toHaveBeenCalledOnce()
  })

  it("Linux 在退出前把 AppImage 暂存到目标目录并启动替换助手", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-appimage-install-"))
    const downloadedPath = path.join(directory, "download.AppImage")
    const target = path.join(directory, "MagicChat.AppImage")
    await writeFile(downloadedPath, "new-appimage")
    await writeFile(target, "old-appimage")
    const calls: unknown[][] = []
    const spawnDetached = ((...args: unknown[]) => {
      calls.push(args)
      const child = new EventEmitter() as EventEmitter & { unref(): void }
      child.unref = vi.fn()
      queueMicrotask(() => child.emit("spawn"))
      return child
    }) as unknown as typeof spawn
    const quit = vi.fn()

    await installDesktopPackage({
      appImagePath: target,
      downloadedPath,
      openPath: async () => "",
      platform: "linux",
      quit,
      runtimePid: 1234,
      spawnDetached,
    })

    expect(calls[0][0]).toBe("/bin/sh")
    expect(calls[0][1]).toEqual([
      "-c",
      expect.stringContaining('while kill -0 "$parent_pid"'),
      "magicchat-appimage-updater",
      "1234",
      target,
      `${target}.magicchat-update`,
      `${target}.magicchat-backup`,
    ])
    await expect(access(`${target}.magicchat-update`)).resolves.toBeUndefined()
    expect(quit).toHaveBeenCalledOnce()
  })
})
