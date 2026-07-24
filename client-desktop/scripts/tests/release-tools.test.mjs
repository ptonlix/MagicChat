import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  aggregateRelease,
  fileSha512,
  linuxArtifactSuffixes,
  parseDesktopTag,
  validateManifest,
} from "../release-tools.mjs"

describe("Desktop Stable 发布工具", () => {
  it("只接受严格的 Stable Tag", () => {
    expect(parseDesktopTag("desktop-v1.2.3")).toBe("1.2.3")
    for (const tag of [
      "v1.2.3",
      "desktop-v01.2.3",
      "desktop-v1.2",
      "desktop-v1.2.3-rc.1",
      "desktop-v1.2.3+build",
    ]) {
      expect(() => parseDesktopTag(tag)).toThrow()
    }
  })

  it("校验清单中的版本、大小和 SHA-512", async () => {
    const directory = await fixtureDirectory()
    const appImage = "MagicChat-1.2.3-linux-x86_64.AppImage"
    const deb = "MagicChat-1.2.3-linux-amd64.deb"
    await Promise.all([
      writeFile(path.join(directory, appImage), "appimage"),
      writeFile(path.join(directory, deb), "deb"),
    ])
    const manifestPath = path.join(directory, "latest-linux.yml")
    await writeManifest(manifestPath, directory, [appImage, deb], "1.2.3")
    await expect(
      validateManifest({
        arch: "x64",
        artifactDirectory: directory,
        expectedVersion: "1.2.3",
        manifestPath,
        platform: "linux",
      }),
    ).resolves.toBeTruthy()
    await writeFile(path.join(directory, appImage), "tampered")
    await expect(
      validateManifest({
        arch: "x64",
        artifactDirectory: directory,
        expectedVersion: "1.2.3",
        manifestPath,
        platform: "linux",
      }),
    ).rejects.toThrow("SHA-512")
  })

  it("映射 electron-builder 的 Linux 平台原生架构名", () => {
    expect(linuxArtifactSuffixes("x64")).toEqual({
      appImage: "linux-x86_64.AppImage",
      deb: "linux-amd64.deb",
    })
    expect(linuxArtifactSuffixes("arm64")).toEqual({
      appImage: "linux-arm64.AppImage",
      deb: "linux-arm64.deb",
    })
    expect(() => linuxArtifactSuffixes("ia32")).toThrow("不支持的 Linux 制品架构")
  })

  it("拒绝缺失制品和 Windows 顶层回退字段", async () => {
    const directory = await fixtureDirectory()
    const manifestPath = path.join(directory, "latest.yml")
    await writeFile(manifestPath, "version: 1.2.3\npath: missing.exe\nsha512: invalid\nfiles: []\n")
    await expect(
      validateManifest({
        arch: "x64",
        artifactDirectory: directory,
        expectedVersion: "1.2.3",
        manifestPath,
        platform: "win",
      }),
    ).rejects.toThrow()
  })

  it("聚合 Windows 双架构清单且拒绝同名冲突", async () => {
    const root = await fixtureDirectory()
    const x64 = path.join(root, "win-x64")
    const arm64 = path.join(root, "win-arm64")
    const output = path.join(root, "release")
    await Promise.all([mkdir(x64), mkdir(arm64)])
    await createWindowsCandidate(x64, "x64")
    await createWindowsCandidate(arm64, "arm64")
    await aggregateRelease({
      expectedVersion: "1.2.3",
      inputs: [
        { arch: "x64", directory: x64, platform: "win" },
        { arch: "arm64", directory: arm64, platform: "win" },
      ],
      outputDirectory: output,
    })
    const manifest = await readFile(path.join(output, "latest.yml"), "utf8")
    expect(manifest).toContain("MagicChat-1.2.3-win-x64.exe")
    expect(manifest).toContain("MagicChat-1.2.3-win-arm64.exe")
    expect(manifest).not.toMatch(/^path:|^sha512:/m)

    await writeFile(path.join(x64, "conflict.txt"), "x64")
    await writeFile(path.join(arm64, "conflict.txt"), "arm64")
    await expect(
      aggregateRelease({
        expectedVersion: "1.2.3",
        inputs: [
          { arch: "x64", directory: x64, platform: "win" },
          { arch: "arm64", directory: arm64, platform: "win" },
        ],
        outputDirectory: path.join(root, "conflict-output"),
      }),
    ).rejects.toThrow("同名内容冲突")
  })
})

async function fixtureDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "magicchat-release-"))
}

async function createWindowsCandidate(directory, arch) {
  const fileName = `MagicChat-1.2.3-win-${arch}.exe`
  await writeFile(path.join(directory, fileName), arch)
  await writeManifest(path.join(directory, "latest.yml"), directory, fileName, "1.2.3")
}

async function writeManifest(manifestPath, directory, fileNames, version) {
  const entries = await Promise.all(
    (Array.isArray(fileNames) ? fileNames : [fileNames]).map(async (fileName) => {
      const artifactPath = path.join(directory, fileName)
      return {
        fileName,
        sha512: await fileSha512(artifactPath),
        size: (await readFile(artifactPath)).byteLength,
      }
    }),
  )
  await writeFile(
    manifestPath,
    `version: ${version}\nfiles:\n${entries
      .map(
        ({ fileName, sha512, size }) =>
          `  - url: ${fileName}\n    sha512: ${sha512}\n    size: ${size}`,
      )
      .join("\n")}\n`,
  )
}
