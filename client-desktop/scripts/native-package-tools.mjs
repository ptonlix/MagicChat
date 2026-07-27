import { execFile } from "node:child_process"
import { lstat, mkdir, mkdtemp, open, readFile, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { extractFile } from "@electron/asar"

const execute = promisify(execFile)
const PE_MACHINES = { arm64: 0xaa64, x64: 0x8664 }
const ELF_MACHINES = { arm64: 0xb7, x64: 0x3e }

export function parsePeMachine(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.toString("ascii", 0, 2) !== "MZ") {
    throw new Error("主应用不是有效 PE 文件")
  }
  const offset = buffer.readUInt32LE(0x3c)
  if (offset + 6 > buffer.length || buffer.toString("ascii", offset, offset + 4) !== "PE\0\0") {
    throw new Error("主应用缺少 PE 签名")
  }
  return buffer.readUInt16LE(offset + 4)
}

export function parseElfMachine(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 20 ||
    !buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  ) {
    throw new Error("主应用不是有效 ELF 文件")
  }
  if (![1, 2].includes(buffer[5])) throw new Error("ELF 字节序无效")
  return buffer[5] === 1 ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18)
}

export function assertMachine(actual, arch, format) {
  const expected = format === "PE" ? PE_MACHINES[arch] : ELF_MACHINES[arch]
  if (!expected || actual !== expected) {
    throw new Error(
      `${format} Machine 与目标架构不一致：期望 ${arch}，实际 0x${actual.toString(16)}`,
    )
  }
}

export async function verifyWindowsPackage({
  arch,
  applicationDirectory,
  artifact,
  expectedVersion,
  executeCommand = execute,
  readAsarVersion = packagedVersion,
}) {
  const installerMachine = await readPeMachine(artifact)
  const installerVersion = await windowsProductVersion(artifact, executeCommand)
  assertWindowsProductVersion(installerVersion, [expectedVersion], "Windows 安装器文件版本")
  const executable = path.join(applicationDirectory, "MagicChat.exe")
  const executableStat = await lstat(executable).catch(() => undefined)
  if (!executableStat?.isFile()) throw new Error("Windows 打包应用缺少 MagicChat.exe")
  assertMachine(await readPeMachine(executable), arch, "PE")
  const applicationVersion = await windowsProductVersion(executable, executeCommand)
  assertWindowsProductVersion(
    applicationVersion,
    [expectedVersion, `${expectedVersion}.0`],
    "Windows 打包应用文件版本",
  )
  const asar = path.join(applicationDirectory, "resources", "app.asar")
  const asarStat = await lstat(asar).catch(() => undefined)
  if (!asarStat?.isFile()) throw new Error("Windows 打包应用缺少 app.asar")
  if ((await readAsarVersion(asar)) !== expectedVersion)
    throw new Error("app.asar 内应用版本与 Tag 不一致")
  return {
    arch,
    installerMachine,
    machine: PE_MACHINES[arch],
    platform: "win",
    version: expectedVersion,
  }
}

export async function verifyLinuxPackage({
  arch,
  appImage,
  deb,
  expectedVersion,
  executeCommand = execute,
  readAsarVersion = packagedVersion,
}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "magicchat-linux-package-"))
  await executeCommand(appImage, ["--appimage-extract"], { cwd: workspace })
  const appImageRoot = path.join(workspace, "squashfs-root")
  const appImageExecutable = await findUnique(
    appImageRoot,
    "magicchat-desktop",
    "AppImage 内缺少主程序",
  )
  assertMachine(parseElfMachine(await readFile(appImageExecutable)), arch, "ELF")
  const appImageAsar = await findUnique(appImageRoot, "app.asar", "AppImage 内缺少 app.asar")
  if ((await readAsarVersion(appImageAsar)) !== expectedVersion)
    throw new Error("AppImage 应用版本与 Tag 不一致")

  const expectedDebArch = arch === "x64" ? "amd64" : "arm64"
  const architectureMetadata = await executeCommand("dpkg-deb", ["-f", deb, "Architecture"])
  const versionMetadata = await executeCommand("dpkg-deb", ["-f", deb, "Version"])
  const debArch = String(architectureMetadata.stdout).trim()
  const debVersion = String(versionMetadata.stdout).trim()
  if (debArch !== expectedDebArch) {
    throw new Error(`deb 架构与目标不一致：期望 ${expectedDebArch}，实际 ${debArch || "空值"}`)
  }
  if (debVersion !== expectedVersion) {
    throw new Error(`deb 版本与 Tag 不一致：期望 ${expectedVersion}，实际 ${debVersion || "空值"}`)
  }
  const debRoot = path.join(workspace, "deb")
  await executeCommand("dpkg-deb", ["-x", deb, debRoot])
  const debExecutable = await findUnique(debRoot, "magicchat-desktop", "deb 内缺少主程序")
  assertMachine(parseElfMachine(await readFile(debExecutable)), arch, "ELF")
  return {
    arch,
    appImageMachine: ELF_MACHINES[arch],
    debArchitecture: debArch,
    platform: "linux",
    version: expectedVersion,
  }
}

export async function verifyMacPackage({
  dmg,
  expectedVersion,
  executeCommand = execute,
  readAsarVersion = packagedVersion,
  zip,
}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "magicchat-mac-package-"))
  const zipRoot = path.join(workspace, "zip")
  await executeCommand("/usr/bin/ditto", ["-x", "-k", zip, zipRoot])
  const zipApp = await findUnique(zipRoot, "MagicChat.app", "ZIP 内缺少 MagicChat.app", true)
  await verifyMacApplication(zipApp, expectedVersion, executeCommand, readAsarVersion)

  const mountpoint = path.join(workspace, "dmg")
  await mkdir(mountpoint)
  await executeCommand("/usr/bin/hdiutil", [
    "attach",
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mountpoint,
    dmg,
  ])
  try {
    const dmgApp = await findUnique(mountpoint, "MagicChat.app", "DMG 内缺少 MagicChat.app", true)
    await verifyMacApplication(dmgApp, expectedVersion, executeCommand, readAsarVersion)
  } finally {
    await executeCommand("/usr/bin/hdiutil", ["detach", mountpoint])
  }
  return { architectures: ["x86_64", "arm64"], platform: "mac", version: expectedVersion }
}

async function verifyMacApplication(application, expectedVersion, executeCommand, readAsarVersion) {
  const plist = path.join(application, "Contents", "Info.plist")
  const identifier = await executeCommand("/usr/bin/plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    plist,
  ])
  if (String(identifier.stdout).trim() !== "com.magicchat.desktop")
    throw new Error("macOS 应用 ID 无效")
  const version = await executeCommand("/usr/bin/plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    plist,
  ])
  if (String(version.stdout).trim() !== expectedVersion)
    throw new Error("macOS 应用版本与 Tag 不一致")
  const executable = path.join(application, "Contents", "MacOS", "MagicChat")
  const { stdout } = await executeCommand("/usr/bin/lipo", ["-archs", executable])
  const architectures = new Set(String(stdout).trim().split(/\s+/))
  if (!architectures.has("x86_64") || !architectures.has("arm64") || architectures.size !== 2) {
    throw new Error("macOS 主二进制不是 x86_64/arm64 Universal")
  }
  const asar = path.join(application, "Contents", "Resources", "app.asar")
  if ((await readAsarVersion(asar)) !== expectedVersion)
    throw new Error("app.asar 内应用版本与 Tag 不一致")
}

async function packagedVersion(asarPath) {
  const metadata = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"))
  return metadata.version
}

async function readPeMachine(filePath) {
  const handle = await open(filePath, "r")
  try {
    const dosHeader = Buffer.alloc(64)
    const dosRead = await handle.read(dosHeader, 0, dosHeader.length, 0)
    if (dosRead.bytesRead !== dosHeader.length || dosHeader.toString("ascii", 0, 2) !== "MZ") {
      throw new Error("文件不是有效 PE 文件")
    }
    const offset = dosHeader.readUInt32LE(0x3c)
    const peHeader = Buffer.alloc(6)
    const peRead = await handle.read(peHeader, 0, peHeader.length, offset)
    if (peRead.bytesRead !== peHeader.length || peHeader.toString("ascii", 0, 4) !== "PE\0\0") {
      throw new Error("文件缺少 PE 签名")
    }
    return peHeader.readUInt16LE(4)
  } finally {
    await handle.close()
  }
}

async function windowsProductVersion(filePath, executeCommand) {
  const { stdout } = await executeCommand("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-Item -LiteralPath '${filePath.replaceAll("'", "''")}').VersionInfo.ProductVersion`,
  ])
  return String(stdout).trim()
}

function assertWindowsProductVersion(actualVersion, expectedVersions, label) {
  if (!expectedVersions.includes(actualVersion)) {
    throw new Error(
      `${label}与 Tag 不一致：期望 ${expectedVersions.join(" 或 ")}，实际 ${actualVersion || "空值"}`,
    )
  }
}

async function findUnique(root, name, message, directory = false) {
  const matches = []
  await walk(root, async (entry, entryStat) => {
    if (path.basename(entry) === name && (directory ? entryStat.isDirectory() : entryStat.isFile()))
      matches.push(entry)
  })
  if (matches.length !== 1) throw new Error(`${message}（找到 ${matches.length} 个）`)
  return matches[0]
}

async function walk(root, visit) {
  const rootStat = await lstat(root).catch(() => undefined)
  if (!rootStat) return
  await visit(root, rootStat)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return
  for (const name of await readdir(root)) await walk(path.join(root, name), visit)
}
