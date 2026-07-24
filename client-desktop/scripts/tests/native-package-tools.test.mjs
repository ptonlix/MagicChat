import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertMachine,
  parseElfMachine,
  parsePeMachine,
  verifyLinuxPackage,
  verifyMacPackage,
  verifyWindowsPackage,
} from "../native-package-tools.mjs"

describe("原生安装包真实性解析", () => {
  it.each([
    ["x64", 0x8664],
    ["arm64", 0xaa64],
  ])("读取 %s PE Machine", (arch, machine) => {
    const fixture = peFixture(machine)
    expect(parsePeMachine(fixture)).toBe(machine)
    expect(() => assertMachine(machine, arch, "PE")).not.toThrow()
    expect(() => assertMachine(machine, arch === "x64" ? "arm64" : "x64", "PE")).toThrow("不一致")
  })

  it.each([
    ["x64", 0x3e],
    ["arm64", 0xb7],
  ])("读取 %s ELF Machine", (arch, machine) => {
    const fixture = elfFixture(machine)
    expect(parseElfMachine(fixture)).toBe(machine)
    expect(() => assertMachine(machine, arch, "ELF")).not.toThrow()
  })

  it("使用固定 7za 解开 NSIS 内部架构包并读取真实 PE", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-nsis-fixture-"))
    const artifact = path.join(root, "renamed-arm64.exe")
    await writeFile(artifact, "fixture")
    const executeCommand = async (command, args) => {
      const output = args.find((value) => value.startsWith("-o"))?.slice(2)
      if (output?.endsWith("outer")) {
        await mkdir(output, { recursive: true })
        await writeFile(path.join(output, "app-64.7z"), "inner")
      } else if (output?.endsWith("application")) {
        await mkdir(path.join(output, "resources"), { recursive: true })
        await writeFile(path.join(output, "MagicChat.exe"), peFixture(0x8664))
        await writeFile(path.join(output, "resources/app.asar"), "asar")
      }
      return { stdout: command === "powershell" ? "1.2.3.0\n" : "" }
    }
    await expect(
      verifyWindowsPackage({
        arch: "x64",
        artifact,
        executeCommand,
        expectedVersion: "1.2.3",
        readAsarVersion: async () => "1.2.3",
        resolve7za: async () => "fixed-7za",
      }),
    ).resolves.toMatchObject({ innerPackage: "app-64.7z", machine: 0x8664 })
    await expect(
      verifyWindowsPackage({
        arch: "arm64",
        artifact,
        executeCommand,
        expectedVersion: "1.2.3",
        readAsarVersion: async () => "1.2.3",
        resolve7za: async () => "fixed-7za",
      }),
    ).rejects.toThrow("app-arm64.7z")
  })

  it("拒绝错误格式和解包失败", async () => {
    expect(() => parsePeMachine(Buffer.alloc(64))).toThrow("PE")
    expect(() => parseElfMachine(Buffer.alloc(20))).toThrow("ELF")
    await expect(
      verifyWindowsPackage({
        arch: "x64",
        artifact: "broken.exe",
        executeCommand: async () => {
          throw new Error("extract failed")
        },
        expectedVersion: "1.2.3",
        resolve7za: async () => "fixed-7za",
      }),
    ).rejects.toThrow("extract failed")
  })

  it("从 ZIP/DMG 读取 plist、Universal 架构与 app.asar 版本", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-mac-fixture-"))
    const executeCommand = async (command, args) => {
      if (command.endsWith("ditto")) await createMacApplication(path.join(args[3], "MagicChat.app"))
      if (command.endsWith("hdiutil") && args[0] === "attach") {
        await createMacApplication(path.join(args[4], "MagicChat.app"))
      }
      if (command.endsWith("plutil")) {
        return { stdout: args[1] === "CFBundleIdentifier" ? "com.magicchat.desktop\n" : "1.2.3\n" }
      }
      if (command.endsWith("lipo")) return { stdout: "x86_64 arm64\n" }
      return { stdout: "" }
    }
    await expect(
      verifyMacPackage({
        dmg: path.join(root, "app.dmg"),
        executeCommand,
        expectedVersion: "1.2.3",
        readAsarVersion: async () => "1.2.3",
        zip: path.join(root, "app.zip"),
      }),
    ).resolves.toMatchObject({ architectures: ["x86_64", "arm64"] })
    await expect(
      verifyMacPackage({
        dmg: path.join(root, "bad.dmg"),
        executeCommand: async (command, args) => {
          const result = await executeCommand(command, args)
          return command.endsWith("lipo") ? { stdout: "arm64\n" } : result
        },
        expectedVersion: "1.2.3",
        readAsarVersion: async () => "1.2.3",
        zip: path.join(root, "bad.zip"),
      }),
    ).rejects.toThrow("Universal")
  })

  it("从 AppImage ELF 与 deb 元数据读取 Linux 真实架构和版本", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-linux-fixture-"))
    const appImage = path.join(root, "app.AppImage")
    const deb = path.join(root, "app.deb")
    const executeCommand = async (command, args, options) => {
      if (command === appImage) {
        const extracted = path.join(options.cwd, "squashfs-root")
        await mkdir(path.join(extracted, "resources"), { recursive: true })
        await writeFile(path.join(extracted, "magicchat-desktop"), elfFixture(0x3e))
        await writeFile(path.join(extracted, "resources/app.asar"), "asar")
      } else if (command === "dpkg-deb" && args[0] === "-x") {
        await mkdir(path.join(args[2], "usr/lib/magicchat"), { recursive: true })
        await writeFile(path.join(args[2], "usr/lib/magicchat/magicchat-desktop"), elfFixture(0x3e))
      }
      return {
        stdout: command === "dpkg-deb" && args[0] === "-f" ? "amd64\n1.2.3\n" : "",
      }
    }
    await expect(
      verifyLinuxPackage({
        appImage,
        arch: "x64",
        deb,
        executeCommand,
        expectedVersion: "1.2.3",
        readAsarVersion: async () => "1.2.3",
      }),
    ).resolves.toMatchObject({ appImageMachine: 0x3e, debArchitecture: "amd64" })
  })
})

function peFixture(machine) {
  const fixture = Buffer.alloc(256)
  fixture.write("MZ")
  fixture.writeUInt32LE(128, 0x3c)
  fixture.write("PE\0\0", 128)
  fixture.writeUInt16LE(machine, 132)
  return fixture
}

function elfFixture(machine) {
  const fixture = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(fixture)
  fixture[5] = 1
  fixture.writeUInt16LE(machine, 18)
  return fixture
}

async function createMacApplication(application) {
  await mkdir(path.join(application, "Contents/MacOS"), { recursive: true })
  await mkdir(path.join(application, "Contents/Resources"), { recursive: true })
  await writeFile(path.join(application, "Contents/Info.plist"), "plist")
  await writeFile(path.join(application, "Contents/MacOS/MagicChat"), "binary")
  await writeFile(path.join(application, "Contents/Resources/app.asar"), "asar")
}
