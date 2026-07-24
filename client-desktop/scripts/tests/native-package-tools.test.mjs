import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertMachine,
  findNsisInnerEntry,
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

  it.each([
    ["x64", "$PLUGINSDIR/app-64.7z", "app-64.7z", 0x8664],
    ["arm64", "$PLUGINSDIR\\app-arm64.7z", "app-arm64.7z", 0xaa64],
  ])(
    "使用固定 7za 解开 NSIS %s 内部架构包并读取真实 PE",
    async (arch, innerEntry, innerName, machine) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-nsis-fixture-"))
      const artifact = path.join(root, "renamed-arm64.exe")
      await writeFile(artifact, "fixture")
      const invocations = []
      const executeCommand = async (command, args) => {
        invocations.push({ args, command })
        if (args[0] === "l") {
          return { stdout: `Path = ${artifact}\r\nType = Nsis\r\n\r\nPath = ${innerEntry}\r\n` }
        }
        const output = args.find((value) => value.startsWith("-o"))?.slice(2)
        if (output?.endsWith("outer")) {
          await mkdir(output, { recursive: true })
          if (args.includes(innerEntry)) await writeFile(path.join(output, innerName), "inner")
        } else if (output?.endsWith("application")) {
          await mkdir(path.join(output, "resources"), { recursive: true })
          await writeFile(path.join(output, "MagicChat.exe"), peFixture(machine))
          await writeFile(path.join(output, "resources/app.asar"), "asar")
        }
        return { stdout: command === "powershell" ? "1.2.3.0\n" : "" }
      }
      await expect(
        verifyWindowsPackage({
          arch,
          artifact,
          executeCommand,
          expectedVersion: "1.2.3",
          readAsarVersion: async () => "1.2.3",
          resolve7za: async () => "fixed-7za",
        }),
      ).resolves.toMatchObject({
        innerEntry,
        innerPackage: innerName,
        machine,
      })
      expect(invocations[0]).toMatchObject({
        args: ["l", "-slt", "-bd", artifact],
        command: "fixed-7za",
      })
      expect(invocations[1]).toMatchObject({
        args: ["e", "-bd", "-y", expect.stringMatching(/outer$/), artifact, innerEntry],
        command: "fixed-7za",
      })
    },
  )

  it("拒绝 NSIS 内部架构包缺失或重复", () => {
    expect(() => findNsisInnerEntry("Path = installer.exe\n", "app-arm64.7z")).toThrow(
      "目录表找到 0 个",
    )
    expect(() =>
      findNsisInnerEntry(
        "Path = $PLUGINSDIR/app-arm64.7z\nPath = $PLUGINSDIR\\app-arm64.7z\n",
        "app-arm64.7z",
      ),
    ).toThrow("目录表找到 2 个")
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

  it.each([
    ["x64", 0x3e, "amd64"],
    ["arm64", 0xb7, "arm64"],
  ])(
    "从 AppImage ELF 与 deb 元数据读取 Linux %s 真实架构和版本",
    async (arch, machine, debArch) => {
      const fixture = await createLinuxPackageFixture({ debArch, machine })
      await expect(
        verifyLinuxPackage({
          appImage: fixture.appImage,
          arch,
          deb: fixture.deb,
          executeCommand: fixture.executeCommand,
          expectedVersion: "1.2.3",
          readAsarVersion: async () => "1.2.3",
        }),
      ).resolves.toMatchObject({ appImageMachine: machine, debArchitecture: debArch })
      expect(fixture.metadataFields).toEqual(["Architecture", "Version"])
    },
  )

  it.each([
    [{ debArch: "arm64" }, "deb 架构与目标不一致：期望 amd64，实际 arm64"],
    [{ debVersion: "1.2.4" }, "deb 版本与 Tag 不一致：期望 1.2.3，实际 1.2.4"],
  ])("拒绝 deb 元数据不匹配", async (overrides, message) => {
    const fixture = await createLinuxPackageFixture({ machine: 0x3e, ...overrides })
    await expect(
      verifyLinuxPackage({
        appImage: fixture.appImage,
        arch: "x64",
        deb: fixture.deb,
        executeCommand: fixture.executeCommand,
        expectedVersion: "1.2.3",
        readAsarVersion: async () => "1.2.3",
      }),
    ).rejects.toThrow(message)
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

async function createLinuxPackageFixture({ debArch = "amd64", debVersion = "1.2.3", machine }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-linux-fixture-"))
  const appImage = path.join(root, "app.AppImage")
  const deb = path.join(root, "app.deb")
  const metadataFields = []
  const executeCommand = async (command, args, options) => {
    if (command === appImage) {
      const extracted = path.join(options.cwd, "squashfs-root")
      await mkdir(path.join(extracted, "resources"), { recursive: true })
      await writeFile(path.join(extracted, "magicchat-desktop"), elfFixture(machine))
      await writeFile(path.join(extracted, "resources/app.asar"), "asar")
    } else if (command === "dpkg-deb" && args[0] === "-f") {
      metadataFields.push(args[2])
      return { stdout: `${args[2] === "Architecture" ? debArch : debVersion}\n` }
    } else if (command === "dpkg-deb" && args[0] === "-x") {
      await mkdir(path.join(args[2], "usr/lib/magicchat"), { recursive: true })
      await writeFile(
        path.join(args[2], "usr/lib/magicchat/magicchat-desktop"),
        elfFixture(machine),
      )
    }
    return { stdout: "" }
  }
  return { appImage, deb, executeCommand, metadataFields }
}

async function createMacApplication(application) {
  await mkdir(path.join(application, "Contents/MacOS"), { recursive: true })
  await mkdir(path.join(application, "Contents/Resources"), { recursive: true })
  await writeFile(path.join(application, "Contents/Info.plist"), "plist")
  await writeFile(path.join(application, "Contents/MacOS/MagicChat"), "binary")
  await writeFile(path.join(application, "Contents/Resources/app.asar"), "asar")
}
