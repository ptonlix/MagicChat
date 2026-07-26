import { createHash } from "node:crypto"
import { copyFile, mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { inflateRawSync } from "node:zlib"
import { load, dump } from "js-yaml"
import { parseDesktopTag, writePackageVersion } from "./release-version.mjs"

export { parseDesktopTag, writePackageVersion }

const SUPPORTED_ARCHES = new Set(["arm64", "universal", "x64"])
const SUPPORTED_PLATFORMS = new Set(["linux", "mac", "win"])
const RELEASE_MANIFESTS = new Set([
  "latest-linux-arm64.yml",
  "latest-linux.yml",
  "latest-mac.yml",
  "latest.yml",
])
const RELEASE_ARTIFACT_EXTENSION = /\.(?:AppImage|blockmap|deb|dmg|exe|zip)$/

export async function readManifest(manifestPath) {
  const value = load(await readFile(manifestPath, "utf8"), { json: true })
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`更新清单不是 YAML 对象：${manifestPath}`)
  }
  return value
}

export async function validateManifest({
  arch,
  artifactDirectory,
  allowWindowsLegacyFields = false,
  expectedVersion,
  manifestPath,
  platform,
}) {
  assertTarget(platform, arch)
  assertStableVersion(expectedVersion)
  const manifest = await readManifest(manifestPath)
  if (manifest.version !== expectedVersion) {
    throw new Error(`清单版本不匹配：${manifestPath}`)
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`清单缺少 files：${manifestPath}`)
  }
  const releaseDate =
    manifest.releaseDate instanceof Date
      ? manifest.releaseDate.toISOString()
      : typeof manifest.releaseDate === "string" && !Number.isNaN(Date.parse(manifest.releaseDate))
        ? new Date(manifest.releaseDate).toISOString()
        : undefined
  if (!releaseDate) {
    throw new Error(`清单 releaseDate 无效：${manifestPath}`)
  }
  if (
    platform === "win" &&
    !allowWindowsLegacyFields &&
    ("path" in manifest || "sha512" in manifest)
  ) {
    throw new Error("Windows latest.yml 禁止包含顶层 path 或 sha512")
  }

  const files = []
  let matchingFiles = 0
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`清单 files 条目无效：${manifestPath}`)
    }
    const fileName = artifactFileName(entry.url)
    if (platform === "win") {
      assertWindowsArtifact(fileName)
      if (fileName.endsWith(`-win-${arch}.exe`)) matchingFiles += 1
    } else {
      const primary = assertArtifactTarget(fileName, platform, arch)
      if (primary) matchingFiles += 1
    }
    const artifactPath = path.join(artifactDirectory, fileName)
    const artifactStat = await stat(artifactPath).catch(() => undefined)
    if (!artifactStat?.isFile()) throw new Error(`清单引用的制品不存在：${fileName}`)
    if (!Number.isSafeInteger(entry.size) || entry.size !== artifactStat.size) {
      throw new Error(`制品大小不匹配：${fileName}`)
    }
    const sha512 = await fileSha512(artifactPath)
    if (entry.sha512 !== sha512) throw new Error(`制品 SHA-512 不匹配：${fileName}`)
    const blockMapSize = entry.blockMapSize
    if (fileName.endsWith(".AppImage")) {
      await validateEmbeddedBlockMap(artifactPath, artifactStat.size, blockMapSize, fileName)
    } else if (fileName.endsWith(".exe") || fileName.endsWith(".zip")) {
      const blockmapPath = path.join(artifactDirectory, `${fileName}.blockmap`)
      const blockmapStat = await stat(blockmapPath).catch(() => undefined)
      if (!blockmapStat?.isFile()) throw new Error(`缺少差分文件：${fileName}.blockmap`)
      if (
        blockMapSize != null &&
        (!Number.isSafeInteger(blockMapSize) || blockMapSize !== blockmapStat.size)
      ) {
        throw new Error(`blockMapSize 与差分文件大小不匹配：${fileName}`)
      }
    }
    files.push({ ...entry, url: fileName })
  }
  if (matchingFiles !== 1) {
    throw new Error(`清单必须唯一包含 ${platform}/${arch} 的 OTA 主制品`)
  }
  return { ...manifest, files, releaseDate }
}

export async function aggregateRelease({ expectedVersion, inputs, outputDirectory }) {
  assertStableVersion(expectedVersion)
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("缺少待聚合的矩阵产物")
  await mkdir(outputDirectory, { recursive: true })
  const copied = new Map()
  const windows = new Map()

  for (const input of inputs) {
    assertTarget(input.platform, input.arch)
    const names = await readdir(input.directory)
    for (const name of names) {
      if (!isReleaseAsset(name)) continue
      const sourcePath = path.join(input.directory, name)
      if (!(await stat(sourcePath)).isFile()) continue
      if (name === "latest.yml" && input.platform === "win") continue
      await copyUnique(sourcePath, path.join(outputDirectory, name), copied)
    }
    if (input.platform === "win") {
      const manifestPath = path.join(input.directory, "latest.yml")
      const manifest = await readManifest(manifestPath)
      if (manifest.version !== expectedVersion || !Array.isArray(manifest.files)) {
        throw new Error(`Windows 候选清单无效：${input.directory}`)
      }
      const matches = manifest.files.filter((entry) => {
        if (!entry || typeof entry !== "object") return false
        try {
          return artifactFileName(entry.url).endsWith(`-win-${input.arch}.exe`)
        } catch {
          return false
        }
      })
      if (matches.length !== 1) {
        throw new Error(`Windows ${input.arch} 候选清单必须唯一引用匹配架构的 NSIS 制品`)
      }
      const fileName = artifactFileName(matches[0].url)
      const artifactPath = path.join(input.directory, fileName)
      const artifactStat = await stat(artifactPath).catch(() => undefined)
      if (!artifactStat?.isFile()) throw new Error(`Windows 制品不存在：${fileName}`)
      if (
        matches[0].size !== artifactStat.size ||
        matches[0].sha512 !== (await fileSha512(artifactPath))
      ) {
        throw new Error(`Windows 候选清单摘要不匹配：${fileName}`)
      }
      windows.set(input.arch, { ...matches[0], url: fileName })
    }
  }

  if (windows.size > 0) {
    if (!windows.has("x64") || !windows.has("arm64") || windows.size !== 2) {
      throw new Error("Windows Release 必须同时包含 x64 和 arm64 候选清单")
    }
    const manifest = {
      version: expectedVersion,
      files: [windows.get("x64"), windows.get("arm64")],
      releaseDate: new Date().toISOString(),
    }
    await writeFile(
      path.join(outputDirectory, "latest.yml"),
      dump(manifest, { lineWidth: -1, noRefs: true }),
    )
  }
}

function isReleaseAsset(name) {
  return RELEASE_MANIFESTS.has(name) || RELEASE_ARTIFACT_EXTENSION.test(name)
}

export async function fileSha512(filePath) {
  return createHash("sha512")
    .update(await readFile(filePath))
    .digest("base64")
}

export async function fileSha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
}

async function validateEmbeddedBlockMap(artifactPath, artifactSize, blockMapSize, fileName) {
  if (!Number.isSafeInteger(blockMapSize) || blockMapSize <= 0 || blockMapSize + 4 > artifactSize) {
    throw new Error(`AppImage blockMapSize 无效：${fileName}`)
  }
  const handle = await open(artifactPath, "r")
  try {
    const sizeBuffer = Buffer.alloc(4)
    await readExactly(handle, sizeBuffer, artifactSize - sizeBuffer.length)
    const embeddedSize = sizeBuffer.readUInt32BE(0)
    if (embeddedSize !== blockMapSize) {
      throw new Error(`blockMapSize 与 AppImage 内嵌差分数据大小不匹配：${fileName}`)
    }
    const compressed = Buffer.alloc(blockMapSize)
    await readExactly(handle, compressed, artifactSize - sizeBuffer.length - blockMapSize)
    let blockMap
    try {
      blockMap = JSON.parse(inflateRawSync(compressed).toString("utf8"))
    } catch {
      throw new Error(`AppImage 内嵌 blockmap 无效：${fileName}`)
    }
    if (
      blockMap?.version !== "2" ||
      !Array.isArray(blockMap.files) ||
      blockMap.files.length === 0
    ) {
      throw new Error(`AppImage 内嵌 blockmap 结构无效：${fileName}`)
    }
  } finally {
    await handle.close()
  }
}

async function readExactly(handle, buffer, position) {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    )
    if (bytesRead === 0) throw new Error("读取 AppImage 内嵌 blockmap 时意外结束")
    offset += bytesRead
  }
}

export function linuxArtifactSuffixes(arch) {
  if (arch === "x64") {
    return {
      appImage: "linux-x86_64.AppImage",
      deb: "linux-amd64.deb",
    }
  }
  if (arch === "arm64") {
    return {
      appImage: "linux-arm64.AppImage",
      deb: "linux-arm64.deb",
    }
  }
  throw new Error(`不支持的 Linux 制品架构：${arch}`)
}

function artifactFileName(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== path.basename(value) ||
    /[\\/?#]/.test(value)
  ) {
    throw new Error("更新清单包含无效制品文件名")
  }
  return value
}

function assertArtifactTarget(fileName, platform, arch) {
  if (platform === "mac") {
    if (fileName.endsWith(`-mac-${arch}.zip`)) return true
    if (fileName.endsWith(`-mac-${arch}.dmg`)) return false
  }
  if (platform === "linux") {
    const suffixes = linuxArtifactSuffixes(arch)
    if (fileName.endsWith(`-${suffixes.appImage}`)) return true
    if (fileName.endsWith(`-${suffixes.deb}`)) return false
  }
  throw new Error(`清单制品与目标平台架构不匹配：${fileName}`)
}

function assertWindowsArtifact(fileName) {
  if (!/-win-(x64|arm64)\.exe$/.test(fileName)) {
    throw new Error(`Windows 清单包含非 NSIS 或无架构标识制品：${fileName}`)
  }
}

function assertStableVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Stable 版本无效：${version}`)
  }
}

function assertTarget(platform, arch) {
  if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHES.has(arch)) {
    throw new Error(`不支持的发布目标：${platform}/${arch}`)
  }
  if ((platform === "mac") !== (arch === "universal")) {
    throw new Error(`发布目标架构无效：${platform}/${arch}`)
  }
}

async function copyUnique(sourcePath, targetPath, copied) {
  const name = path.basename(targetPath)
  const digest = await fileSha512(sourcePath)
  const existing = copied.get(name)
  if (existing && existing !== digest) throw new Error(`矩阵产物发生同名内容冲突：${name}`)
  if (!existing) {
    await copyFile(sourcePath, targetPath)
    copied.set(name, digest)
  }
}
