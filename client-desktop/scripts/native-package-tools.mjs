import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { lstat, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { extractFile } from "@electron/asar"

const execute = promisify(execFile)
const require = createRequire(import.meta.url)
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
  artifact,
  expectedVersion,
  executeCommand = execute,
  readAsarVersion = packagedVersion,
  resolve7za = resolveElectronBuilder7za,
}) {
  const sevenZip = await resolve7za()
  const workspace = await mkdtemp(path.join(os.tmpdir(), "magicchat-nsis-"))
  const outer = path.join(workspace, "outer")
  const innerName = arch === "x64" ? "app-64.7z" : "app-arm64.7z"
  const innerEntry = `$PLUGINSDIR/${innerName}`
  await executeCommand(sevenZip, ["e", "-bd", "-y", `-o${outer}`, artifact, innerEntry])
  const inner = await findUnique(outer, innerName, `NSIS 缺少内部架构包 ${innerName}`)
  const application = path.join(workspace, "application")
  await executeCommand(sevenZip, ["x", "-bd", "-y", `-o${application}`, inner])
  const executable = await findUnique(application, "MagicChat.exe", "NSIS 内部缺少 MagicChat.exe")
  assertMachine(parsePeMachine(await readFile(executable)), arch, "PE")
  const { stdout } = await executeCommand("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-Item -LiteralPath '${executable.replaceAll("'", "''")}').VersionInfo.ProductVersion`,
  ])
  if (!String(stdout).trim().startsWith(expectedVersion))
    throw new Error("Windows 应用文件版本与 Tag 不一致")
  const asar = await findUnique(application, "app.asar", "NSIS 内部缺少 app.asar")
  if ((await readAsarVersion(asar)) !== expectedVersion)
    throw new Error("app.asar 内应用版本与 Tag 不一致")
  return {
    arch,
    innerEntry,
    innerPackage: innerName,
    machine: PE_MACHINES[arch],
    platform: "win",
    sevenZip,
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

async function resolveElectronBuilder7za() {
  const electronBuilder = path.dirname(require.resolve("electron-builder/package.json"))
  const modulePath = path.resolve(electronBuilder, "../app-builder-lib/out/toolsets/7zip.js")
  const module = await import(pathToFileURL(modulePath).href)
  return module.getPath7za()
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
