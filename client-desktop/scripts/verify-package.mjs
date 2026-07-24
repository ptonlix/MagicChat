import { execFile } from "node:child_process"
import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { extractFile } from "@electron/asar"
import { load } from "js-yaml"
import { parseDesktopTag, validateManifest } from "./release-tools.mjs"

const execute = promisify(execFile)
const root = path.resolve(import.meta.dirname, "..")
const platform = argument("platform")
const arch = argument("arch")
const tag = argument("tag")
if (
  !["win", "mac", "linux"].includes(platform) ||
  !["x64", "arm64", "universal"].includes(arch) ||
  (arch === "universal") !== (platform === "mac")
) {
  throw new Error(
    "用法：pnpm verify:package -- --platform <win|mac|linux> --arch <x64|arm64|universal> [--tag desktop-v<semver>]",
  )
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const expectedVersion = tag ? parseDesktopTag(tag) : packageJson.version
assert(packageJson.version === expectedVersion, "package.json 版本与 Tag 不一致")
const builder = load(await readFile(path.join(root, "electron-builder.yml"), "utf8"))
assert(builder.appId === "com.magicchat.desktop", "应用 ID 配置无效")
assert(builder.publish?.provider === "github", "Desktop 更新源必须使用 GitHub provider")
assert(
  builder.publish?.owner === "ptonlix" && builder.publish?.repo === "MagicChat",
  "Desktop 更新源仓库无效",
)
assert(builder.publish?.releaseType === "release", "Stable Release 不得使用草稿或预发布类型")

const unpackedDirectory =
  platform === "mac"
    ? path.join(root, "dist", "mac-universal")
    : path.join(
        root,
        "dist",
        `${platform === "win" ? "win" : "linux"}${arch === "arm64" ? "-arm64" : ""}-unpacked`,
      )
const applicationRoot =
  platform === "mac" ? path.join(unpackedDirectory, "MagicChat.app") : unpackedDirectory
const resources =
  platform === "mac"
    ? path.join(applicationRoot, "Contents", "Resources")
    : path.join(applicationRoot, "resources")
const asarPath = path.join(resources, "app.asar")
assert((await stat(asarPath)).size > 1024, "app.asar 为空")
const packagedMetadata = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"))
assert(packagedMetadata.version === expectedVersion, "app.asar 内应用版本与 Tag 不一致")

if (platform === "mac") await verifyMac(applicationRoot, expectedVersion)
else
  await stat(path.join(applicationRoot, platform === "win" ? "MagicChat.exe" : "magicchat-desktop"))

const distNames = await readdir(path.join(root, "dist"))
for (const suffix of expectedArtifacts(platform, arch)) {
  assert(
    distNames.some((name) => name === `MagicChat-${expectedVersion}-${suffix}`),
    `缺少发布制品：MagicChat-${expectedVersion}-${suffix}`,
  )
}

const manifestName =
  platform === "win"
    ? "latest.yml"
    : platform === "mac"
      ? "latest-mac.yml"
      : arch === "arm64"
        ? "latest-linux-arm64.yml"
        : "latest-linux.yml"
await validateManifest({
  allowWindowsLegacyFields: platform === "win",
  arch,
  artifactDirectory: path.join(root, "dist"),
  expectedVersion,
  manifestPath: path.join(root, "dist", manifestName),
  platform,
})

console.log(
  JSON.stringify({
    appId: builder.appId,
    arch,
    platform,
    version: expectedVersion,
  }),
)

async function verifyMac(applicationRoot, expectedVersion) {
  const plist = path.join(applicationRoot, "Contents", "Info.plist")
  const identifier = await plistValue(plist, "CFBundleIdentifier")
  const version = await plistValue(plist, "CFBundleShortVersionString")
  const minimum = await plistValue(plist, "LSMinimumSystemVersion")
  const arbitraryLoads = await plistValue(plist, "NSAppTransportSecurity.NSAllowsArbitraryLoads")
  const localNetworking = await plistValue(plist, "NSAppTransportSecurity.NSAllowsLocalNetworking")
  assert(identifier === "com.magicchat.desktop", "macOS 应用 ID 无效")
  assert(version === expectedVersion, "macOS 应用版本与 Tag 不一致")
  assert(minimum === "13.0", "macOS 最低系统版本无效")
  assert(
    arbitraryLoads === "false" && localNetworking === "false",
    "macOS ATS 未关闭不安全网络例外",
  )
  const plistText = await readFile(plist)
  assert(!plistText.includes(Buffer.from("NSExceptionDomains")), "macOS ATS 包含域名级网络例外")
  assert(plistText.includes(Buffer.from("magicchat")), "macOS 未注册 magicchat 协议")
}

function expectedArtifacts(targetPlatform, targetArch) {
  if (targetPlatform === "win") return [`win-${targetArch}.exe`]
  if (targetPlatform === "mac") return ["mac-universal.dmg", "mac-universal.zip"]
  return [`linux-${targetArch}.AppImage`, `linux-${targetArch}.deb`]
}

async function plistValue(plist, key) {
  const { stdout } = await execute("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist])
  return stdout.trim()
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
