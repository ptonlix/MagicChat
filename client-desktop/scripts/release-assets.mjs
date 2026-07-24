import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { dump } from "js-yaml"
import {
  fileSha256,
  fileSha512,
  linuxArtifactSuffixes,
  validateManifest,
} from "./release-tools.mjs"

export const RELEASE_TARGETS = ["win:x64", "win:arm64", "mac:universal", "linux:x64", "linux:arm64"]
const INSTALL_ASSET = /\.(?:AppImage|deb|dmg|exe|zip)$/
const MANIFEST = /^latest(?:-mac|-linux|-linux-arm64)?\.yml$/

export function parseReleaseInput(value) {
  const first = value.indexOf(":")
  const second = value.indexOf(":", first + 1)
  if (first <= 0 || second <= first + 1 || second === value.length - 1) {
    throw new Error(`发布输入格式无效：${value}`)
  }
  return {
    platform: value.slice(0, first),
    arch: value.slice(first + 1, second),
    directory: value.slice(second + 1),
  }
}

export function targetAssetModel(version, platform, arch) {
  const prefix = `MagicChat-${version}`
  if (platform === "win") {
    const installer = `${prefix}-win-${arch}.exe`
    return {
      manifest: "latest.yml",
      manifestAssets: [installer],
      publicAssets: [installer, `${installer}.blockmap`],
    }
  }
  if (platform === "mac" && arch === "universal") {
    const dmg = `${prefix}-mac-universal.dmg`
    const zip = `${prefix}-mac-universal.zip`
    return {
      manifest: "latest-mac.yml",
      manifestAssets: [dmg, zip],
      publicAssets: [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`],
    }
  }
  if (platform === "linux" && ["x64", "arm64"].includes(arch)) {
    const suffixes = linuxArtifactSuffixes(arch)
    const appImage = `${prefix}-${suffixes.appImage}`
    const deb = `${prefix}-${suffixes.deb}`
    return {
      manifest: arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml",
      manifestAssets: [appImage, deb],
      publicAssets: [appImage, `${appImage}.blockmap`, deb],
    }
  }
  throw new Error(`不支持的发布目标：${platform}/${arch}`)
}

export async function prepareReleaseAssets({
  commit,
  inputs,
  notes,
  outputDirectory,
  releaseDate,
  tag,
  version,
}) {
  assertInputs(inputs)
  await assertOutputAvailable(outputDirectory)
  await mkdir(path.dirname(outputDirectory), { recursive: true })
  const staging = await mkdtemp(
    path.join(path.dirname(outputDirectory), ".magicchat-release-assets-"),
  )
  try {
    const copied = new Map()
    const windows = new Map()
    for (const input of inputs) {
      const model = targetAssetModel(version, input.platform, input.arch)
      await assertInputAssets(input.directory, model)
      const validated = await validateManifest({
        allowMissingBlockMapSize: input.platform === "mac",
        allowWindowsLegacyFields: input.platform === "win",
        arch: input.arch,
        artifactDirectory: input.directory,
        expectedVersion: version,
        manifestPath: path.join(input.directory, model.manifest),
        platform: input.platform,
      })
      assertManifestAssetSet(validated, model)
      for (const name of model.publicAssets) {
        await copyUnique(path.join(input.directory, name), path.join(staging, name), copied)
      }
      if (input.platform === "win") {
        const installer = model.publicAssets[0]
        const entry = validated.files.find((value) => value?.url === installer)
        if (!entry) throw new Error(`Windows ${input.arch} 清单缺少唯一安装器：${installer}`)
        windows.set(input.arch, { ...entry, url: installer })
      } else {
        await writeFile(
          path.join(staging, model.manifest),
          dump(validated, { lineWidth: -1, noRefs: true }),
        )
      }
    }
    await writeFile(
      path.join(staging, "latest.yml"),
      dump(
        {
          version,
          files: [windows.get("x64"), windows.get("arm64")],
          releaseDate,
        },
        { lineWidth: -1, noRefs: true },
      ),
    )
    for (const [platform, arch, manifest] of [
      ["win", "x64", "latest.yml"],
      ["win", "arm64", "latest.yml"],
      ["mac", "universal", "latest-mac.yml"],
      ["linux", "x64", "latest-linux.yml"],
      ["linux", "arm64", "latest-linux-arm64.yml"],
    ]) {
      await validateManifest({
        arch,
        artifactDirectory: staging,
        expectedVersion: version,
        manifestPath: path.join(staging, manifest),
        platform,
      })
    }

    const expected = expectedReleaseAssetNames(version)
    await assertExactSet(staging, expected)
    const assets = await Promise.all(
      [...expected].sort().map(async (name) => {
        const filePath = path.join(staging, name)
        return {
          name,
          path: name,
          sha256: await fileSha256(filePath),
          sha512: await fileSha512(filePath),
          size: (await stat(filePath)).size,
        }
      }),
    )
    const appendix = generateReleaseAppendix({ assets, version })
    const finalNotes = `${notes.trim()}\n\n---\n\n${appendix}\n`
    const notesPath = path.join(staging, "release-notes.md")
    await writeFile(notesPath, finalNotes)
    const plan = {
      schemaVersion: 1,
      assets,
      commit,
      notes: "release-notes.md",
      notesSha256: await fileSha256(notesPath),
      releaseDate,
      repository: "ptonlix/MagicChat",
      tag,
      version,
    }
    await writeFile(path.join(staging, "release-plan.json"), `${JSON.stringify(plan, null, 2)}\n`)
    const output = await lstat(outputDirectory).catch(() => undefined)
    if (output) await rmdir(outputDirectory)
    await rename(staging, outputDirectory)
    return { ...plan, outputDirectory }
  } catch (error) {
    await rm(staging, { force: true, recursive: true })
    throw error
  }
}

export function expectedReleaseAssetNames(version) {
  const names = new Set([
    "latest.yml",
    "latest-mac.yml",
    "latest-linux.yml",
    "latest-linux-arm64.yml",
  ])
  for (const target of RELEASE_TARGETS) {
    const [platform, arch] = target.split(":")
    for (const name of targetAssetModel(version, platform, arch).publicAssets) names.add(name)
  }
  return names
}

export function generateReleaseAppendix({ assets, version }) {
  return `## 自动发布附录

### 支持与更新载体

- Windows x64/arm64：NSIS
- macOS Intel/Apple Silicon：Universal ZIP；DMG 用于安装与恢复
- Linux x64/arm64：AppImage；deb 用于手动安装与恢复

### 公开资产与 SHA-512

${assets.map((asset) => `- \`${asset.name}\`：\`${asset.sha512}\``).join("\n")}

### 恢复说明

若 ${version} 无法完成应用内更新，请从同一公开 Release 下载与平台和架构匹配的安装载体；不得覆盖同一 Tag 的既有资产。`
}

async function assertInputAssets(directory, model) {
  const names = await readdir(directory)
  const expected = new Set([...model.publicAssets, model.manifest])
  const relevant = names.filter(
    (name) => INSTALL_ASSET.test(name) || name.endsWith(".blockmap") || MANIFEST.test(name),
  )
  const missing = [...expected].filter((name) => !relevant.includes(name))
  const extra = relevant.filter((name) => !expected.has(name))
  if (missing.length || extra.length) {
    throw new Error(`目标资产集合不匹配：缺失 [${missing.join(", ")}]，额外 [${extra.join(", ")}]`)
  }
}

async function assertExactSet(directory, expected) {
  const actual = new Set(await readdir(directory))
  const missing = [...expected].filter((name) => !actual.has(name))
  const extra = [...actual].filter((name) => !expected.has(name))
  if (missing.length || extra.length)
    throw new Error(`最终资产集合不匹配：缺失 [${missing.join(", ")}]，额外 [${extra.join(", ")}]`)
}

function assertInputs(inputs) {
  const targets = inputs.map((input) => `${input.platform}:${input.arch}`)
  const unique = new Set(targets)
  const missing = RELEASE_TARGETS.filter((target) => !unique.has(target))
  const extra = targets.filter((target) => !RELEASE_TARGETS.includes(target))
  if (
    inputs.length !== RELEASE_TARGETS.length ||
    unique.size !== inputs.length ||
    missing.length ||
    extra.length
  ) {
    throw new Error(
      `发布输入必须恰好包含五个目标：缺失 [${missing.join(", ")}]，额外或重复 [${extra.join(", ")}]`,
    )
  }
}

function assertManifestAssetSet(manifest, model) {
  const actual = new Set(manifest.files.map((entry) => entry.url))
  const missing = model.manifestAssets.filter((name) => !actual.has(name))
  const extra = [...actual].filter((name) => !model.manifestAssets.includes(name))
  if (missing.length || extra.length || actual.size !== manifest.files.length) {
    throw new Error(
      `清单载体集合不匹配：缺失 [${missing.join(", ")}]，额外或重复 [${extra.join(", ")}]`,
    )
  }
}

async function assertOutputAvailable(outputDirectory) {
  const output = await lstat(outputDirectory).catch(() => undefined)
  if (!output) return
  if (!output.isDirectory() || (await readdir(outputDirectory)).length > 0) {
    throw new Error("发布资产输出目录必须不存在或为空")
  }
}

async function copyUnique(source, target, copied) {
  const name = path.basename(target)
  const digest = await fileSha512(source)
  const existing = copied.get(name)
  if (existing && existing !== digest) throw new Error(`矩阵产物发生同名内容冲突：${name}`)
  if (!existing) {
    await copyFile(source, target)
    copied.set(name, digest)
  }
}
