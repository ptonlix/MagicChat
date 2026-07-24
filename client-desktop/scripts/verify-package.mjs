import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { load } from "js-yaml"
import {
  verifyLinuxPackage,
  verifyMacPackage,
  verifyWindowsPackage,
} from "./native-package-tools.mjs"
import { linuxArtifactSuffixes, parseDesktopTag, validateManifest } from "./release-tools.mjs"

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

const dist = path.join(root, "dist")
const names = await readdir(dist)
let nativeResult
if (platform === "win") {
  nativeResult = await verifyWindowsPackage({
    arch,
    artifact: artifact(`win-${arch}.exe`),
    expectedVersion,
  })
} else if (platform === "mac") {
  nativeResult = await verifyMacPackage({
    dmg: artifact("mac-universal.dmg"),
    expectedVersion,
    zip: artifact("mac-universal.zip"),
  })
} else {
  const suffixes = linuxArtifactSuffixes(arch)
  nativeResult = await verifyLinuxPackage({
    appImage: artifact(suffixes.appImage),
    arch,
    deb: artifact(suffixes.deb),
    expectedVersion,
  })
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
  allowMissingBlockMapSize: platform === "mac",
  allowWindowsLegacyFields: platform === "win",
  arch,
  artifactDirectory: dist,
  expectedVersion,
  manifestPath: path.join(dist, manifestName),
  platform,
})
console.log(JSON.stringify({ appId: builder.appId, ...nativeResult }))

function artifact(suffix) {
  const expected = `MagicChat-${expectedVersion}-${suffix}`
  if (!names.includes(expected)) throw new Error(`缺少发布制品：${expected}`)
  return path.join(dist, expected)
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
