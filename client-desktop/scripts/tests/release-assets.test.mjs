import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { deflateRawSync } from "node:zlib"
import { dump, load } from "js-yaml"
import { describe, expect, it } from "vitest"
import {
  expectedReleaseAssetNames,
  parseReleaseInput,
  prepareReleaseAssets,
  targetAssetModel,
} from "../release-assets.mjs"
import { fileSha512 } from "../release-tools.mjs"

const release = {
  commit: "0123456789012345678901234567890123456789",
  notes: "MagicChat Desktop 1.2.3\n\n## 版本亮点\n\n- 更安全。\n\n## Bug 修复\n\n- 修复发布流程。",
  releaseDate: "2026-07-24T00:00:00.000Z",
  tag: "desktop-v1.2.3",
  version: "1.2.3",
}

describe("确定性发布资产计划", () => {
  it("兼容 Windows、macOS 与 Linux 输入路径格式", () => {
    expect(parseReleaseInput("win:x64:C:\\runner temp\\artifacts")).toEqual({
      arch: "x64",
      directory: "C:\\runner temp\\artifacts",
      platform: "win",
    })
    expect(parseReleaseInput("mac:universal:/Users/runner/artifacts").directory).toBe(
      "/Users/runner/artifacts",
    )
    expect(parseReleaseInput("linux:arm64:/home/runner/artifacts").directory).toBe(
      "/home/runner/artifacts",
    )
  })

  it("一次准备五目标精确资产、双摘要、清单与人工说明", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-assets-"))
    const inputs = await createInputs(root)
    const first = path.join(root, "release-1")
    const second = path.join(root, "release-2")
    await prepareReleaseAssets({ ...release, inputs, outputDirectory: first })
    await prepareReleaseAssets({ ...release, inputs, outputDirectory: second })
    const plan = JSON.parse(await readFile(path.join(first, "release-plan.json"), "utf8"))
    expect(new Set(plan.assets.map((asset) => asset.name))).toEqual(
      expectedReleaseAssetNames("1.2.3"),
    )
    expect(plan.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256) && asset.sha512)).toBe(
      true,
    )
    expect(await readFile(path.join(first, "release-plan.json"), "utf8")).toBe(
      await readFile(path.join(second, "release-plan.json"), "utf8"),
    )
    const notes = await readFile(path.join(first, "release-notes.md"), "utf8")
    expect(notes.startsWith(release.notes)).toBe(true)
    expect(notes).toContain("## 自动发布附录")
    expect(notes).toContain("## 版本亮点")
    expect(await readdir(first)).not.toContain(
      "MagicChat-1.2.3-mac-universal.dmg.blockmap",
    )
  })

  it("拒绝缺失、额外、重复目标和陈旧输出", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-assets-invalid-"))
    const inputs = await createInputs(root)
    await writeFile(path.join(inputs[0].directory, "Unexpected-1.2.3.exe"), "extra")
    await expect(
      prepareReleaseAssets({
        ...release,
        inputs,
        outputDirectory: path.join(root, "extra-output"),
      }),
    ).rejects.toThrow("额外")

    const cleanInputs = await createInputs(path.join(root, "clean"))
    await expect(
      prepareReleaseAssets({
        ...release,
        inputs: cleanInputs.slice(0, 4),
        outputDirectory: path.join(root, "missing-output"),
      }),
    ).rejects.toThrow("五个目标")
    await expect(
      prepareReleaseAssets({
        ...release,
        inputs: [...cleanInputs.slice(0, 4), cleanInputs[0]],
        outputDirectory: path.join(root, "duplicate-output"),
      }),
    ).rejects.toThrow("重复")
    const stale = path.join(root, "stale")
    await mkdir(stale)
    await writeFile(path.join(stale, "old.exe"), "old")
    await expect(
      prepareReleaseAssets({ ...release, inputs: cleanInputs, outputDirectory: stale }),
    ).rejects.toThrow("必须不存在或为空")
    expect(await readdir(stale)).toEqual(["old.exe"])
  })

  it("拒绝缺失 blockmap 和 blockMapSize 不一致", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-assets-blockmap-"))
    const inputs = await createInputs(root)
    const model = targetAssetModel("1.2.3", "win", "x64")
    const manifestPath = path.join(inputs[0].directory, model.manifest)
    const manifest = load(await readFile(manifestPath, "utf8"))
    manifest.files[0].blockMapSize += 1
    await writeFile(manifestPath, dump(manifest))
    await expect(
      prepareReleaseAssets({ ...release, inputs, outputDirectory: path.join(root, "output") }),
    ).rejects.toThrow("blockMapSize")
    await expect(readdir(path.join(root, "output"))).rejects.toThrow()
  })
})

async function createInputs(root) {
  await mkdir(root, { recursive: true })
  const inputs = []
  for (const target of ["win:x64", "win:arm64", "mac:universal", "linux:x64", "linux:arm64"]) {
    const [platform, arch] = target.split(":")
    const directory = path.join(root, `${platform}-${arch}`)
    await mkdir(directory)
    const model = targetAssetModel("1.2.3", platform, arch)
    for (const name of model.publicAssets)
      await writeFile(path.join(directory, name), `${target}:${name}`)
    for (const name of model.ignoredAssets ?? [])
      await writeFile(path.join(directory, name), `${target}:${name}`)
    const embeddedBlockMapSizes = new Map()
    for (const name of model.manifestAssets) {
      if (name.endsWith(".AppImage")) {
        embeddedBlockMapSizes.set(name, await appendEmbeddedBlockMap(path.join(directory, name)))
      }
    }
    const primary = model.manifestAssets
    const files = await Promise.all(
      primary.map(async (name) => ({
        ...(!name.endsWith(".AppImage") && !name.endsWith(".exe") && !name.endsWith(".zip")
          ? {}
          : {
              blockMapSize:
                embeddedBlockMapSizes.get(name) ??
                (await readFile(path.join(directory, `${name}.blockmap`))).byteLength,
            }),
        sha512: await fileSha512(path.join(directory, name)),
        size: (await readFile(path.join(directory, name))).byteLength,
        url: name,
      })),
    )
    await writeFile(
      path.join(directory, model.manifest),
      dump({ files, releaseDate: release.releaseDate, version: release.version }),
    )
    inputs.push({ arch, directory, platform })
  }
  return inputs
}

async function appendEmbeddedBlockMap(artifactPath) {
  const compressed = deflateRawSync(
    JSON.stringify({
      files: [{ checksums: ["fixture"], name: "file", offsets: [0] }],
      version: "2",
    }),
  )
  const sizeBuffer = Buffer.alloc(4)
  sizeBuffer.writeUInt32BE(compressed.length)
  await writeFile(
    artifactPath,
    Buffer.concat([await readFile(artifactPath), compressed, sizeBuffer]),
  )
  return compressed.length
}
