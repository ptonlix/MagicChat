import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)
const root = path.resolve(import.meta.dirname, "..")
const platform = argument("platform")
const arch = argument("arch")
if (
  !["win", "mac", "linux"].includes(platform) ||
  !["x64", "arm64", "universal"].includes(arch) ||
  (arch === "universal" && platform !== "mac")
) {
  throw new Error(
    "用法：pnpm verify:package -- --platform <win|mac|linux> --arch <x64|arm64|universal>（universal 仅支持 mac）",
  )
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const builder = await readFile(path.join(root, "electron-builder.yml"), "utf8")
assert(builder.includes("appId: com.magicchat.desktop"), "应用 ID 配置无效")
assert(packageJson.version && packageJson.version !== "0.0.0", "应用版本无效")

const unpackedDirectory =
  platform === "mac"
    ? path.join(
        root,
        "dist",
        arch === "universal" ? "mac-universal" : arch === "arm64" ? "mac-arm64" : "mac",
      )
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
assert((await stat(path.join(resources, "app.asar"))).size > 1024, "app.asar 为空")

if (platform === "mac") await verifyMac(applicationRoot)
else
  await stat(path.join(applicationRoot, platform === "win" ? "MagicChat.exe" : "magicchat-desktop"))

console.log(
  JSON.stringify({ appId: "com.magicchat.desktop", arch, platform, version: packageJson.version }),
)

async function verifyMac(applicationRoot) {
  const plist = path.join(applicationRoot, "Contents", "Info.plist")
  const identifier = await plistValue(plist, "CFBundleIdentifier")
  const version = await plistValue(plist, "CFBundleShortVersionString")
  const minimum = await plistValue(plist, "LSMinimumSystemVersion")
  const arbitraryLoads = await plistValue(plist, "NSAppTransportSecurity.NSAllowsArbitraryLoads")
  const localNetworking = await plistValue(plist, "NSAppTransportSecurity.NSAllowsLocalNetworking")
  assert(identifier === "com.magicchat.desktop", "macOS 应用 ID 无效")
  assert(version === packageJson.version, "macOS 应用版本无效")
  assert(minimum === "13.0", "macOS 最低系统版本无效")
  assert(
    arbitraryLoads === "false" && localNetworking === "false",
    "macOS ATS 未关闭不安全网络例外",
  )
  const plistText = await readFile(plist)
  assert(!plistText.includes(Buffer.from("NSExceptionDomains")), "macOS ATS 包含域名级网络例外")
  assert(plistText.includes(Buffer.from("magicchat")), "macOS 未注册 magicchat 协议")
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
