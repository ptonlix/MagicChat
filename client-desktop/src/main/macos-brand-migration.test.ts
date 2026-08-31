// @vitest-environment node

import { mkdir, mkdtemp, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { macApplicationBundlePath, migrateLegacyMacApplication } from "@main/macos-brand-migration"

describe("macOS 品牌应用迁移", () => {
  it("只在即应已安装后迁移相同 Bundle ID 的旧应用", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jiying-brand-migration-"))
    const applications = path.join(root, "Applications")
    const legacyApplication = path.join(applications, "MagicChat.app")
    await mkdir(legacyApplication, { recursive: true })
    const confirm = vi.fn(async () => true)
    const trashItem = vi.fn(async () => undefined)

    const result = await migrateLegacyMacApplication({
      applicationDirectories: [applications],
      confirm,
      currentExecutablePath: path.join(applications, "即应.app/Contents/MacOS/即应"),
      homePath: root,
      isPackaged: true,
      platform: "darwin",
      readBundleIdentifier: async () => "com.magicchat.desktop",
      trashItem,
    })

    expect(result).toEqual({ legacyApplications: [legacyApplication], status: "migrated" })
    expect(confirm).toHaveBeenCalledWith([legacyApplication])
    expect(trashItem).toHaveBeenCalledWith(legacyApplication)
  })

  it("从 DMG 直接运行时不删除 Applications 中的旧应用", async () => {
    const confirm = vi.fn(async () => true)
    const trashItem = vi.fn(async () => undefined)
    const result = await migrateLegacyMacApplication({
      applicationDirectories: ["/Applications"],
      confirm,
      currentExecutablePath: "/Volumes/即应/即应.app/Contents/MacOS/即应",
      homePath: "/Users/example",
      isPackaged: true,
      platform: "darwin",
      trashItem,
    })

    expect(result.status).toBe("not-needed")
    expect(confirm).not.toHaveBeenCalled()
    expect(trashItem).not.toHaveBeenCalled()
  })

  it("拒绝迁移或移入废纸篓失败时阻止新应用继续启动", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jiying-brand-migration-blocked-"))
    const applications = path.join(root, "Applications")
    const legacyApplication = path.join(applications, "MagicChat.app")
    await mkdir(legacyApplication, { recursive: true })
    const base = {
      applicationDirectories: [applications],
      currentExecutablePath: path.join(applications, "即应.app/Contents/MacOS/即应"),
      homePath: root,
      isPackaged: true,
      platform: "darwin" as const,
      readBundleIdentifier: async () => "com.magicchat.desktop",
    }

    await expect(
      migrateLegacyMacApplication({
        ...base,
        confirm: async () => false,
        trashItem: vi.fn(async () => undefined),
      }),
    ).resolves.toEqual({ legacyApplications: [legacyApplication], status: "blocked" })
    await expect(
      migrateLegacyMacApplication({
        ...base,
        confirm: async () => true,
        trashItem: async () => {
          throw new Error("permission denied")
        },
      }),
    ).resolves.toEqual({ legacyApplications: [legacyApplication], status: "blocked" })
  })

  it("不迁移不同 Bundle ID 或符号链接伪装的应用", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jiying-brand-migration-safe-"))
    const firstApplications = path.join(root, "Applications")
    const secondApplications = path.join(root, "User Applications")
    await mkdir(path.join(firstApplications, "MagicChat.app"), { recursive: true })
    await mkdir(secondApplications, { recursive: true })
    await symlink(
      path.join(firstApplications, "MagicChat.app"),
      path.join(secondApplications, "MagicChat.app"),
    )
    const trashItem = vi.fn(async () => undefined)

    const result = await migrateLegacyMacApplication({
      applicationDirectories: [firstApplications, secondApplications],
      confirm: async () => true,
      currentExecutablePath: path.join(firstApplications, "即应.app/Contents/MacOS/即应"),
      homePath: root,
      isPackaged: true,
      platform: "darwin",
      readBundleIdentifier: async () => "com.example.unrelated",
      trashItem,
    })

    expect(result.status).toBe("not-needed")
    expect(trashItem).not.toHaveBeenCalled()
  })

  it("从主程序可执行文件路径提取 .app 根目录", () => {
    expect(macApplicationBundlePath("/Applications/即应.app/Contents/MacOS/即应")).toBe(
      "/Applications/即应.app",
    )
    expect(macApplicationBundlePath("/tmp/即应")).toBeUndefined()
  })
})
