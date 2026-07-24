import { readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileSha512, parseDesktopTag } from "./release-tools.mjs"

const tag = argument("tag")
const artifacts = path.resolve(argument("artifacts") ?? "")
const output = path.resolve(argument("output") ?? "")
if (!tag || !artifacts || !output) {
  throw new Error(
    "用法：node scripts/generate-release-notes.mjs --tag <tag> --artifacts <目录> --output <文件>",
  )
}

const version = parseDesktopTag(tag)
const assets = []
for (const name of (await readdir(artifacts)).sort()) {
  const filePath = path.join(artifacts, name)
  if (!(await stat(filePath)).isFile() || name.endsWith(".yml")) continue
  assets.push(`- \`${name}\`：\`${await fileSha512(filePath)}\``)
}

const notes = `# MagicChat Desktop ${version}

## 支持与更新载体

- Windows x64/arm64：NSIS 应用内更新，使用单一 \`latest.yml\`。
- macOS 13/14/15、Intel/Apple Silicon：Universal ZIP 用于应用内更新；DMG 用于首次安装和失败恢复。实际支持组合以真机验收记录为准。
- Linux x64/arm64：AppImage 应用内更新；deb 仅提供匹配架构的手动升级。

## 发布校验

- 客户端匿名读取公开仓库 \`ptonlix/MagicChat\`，构建产物不包含 GitHub Token。
- 发布链路校验 HTTPS、版本、平台、架构、文件大小和 SHA-512。

## 制品 SHA-512

${assets.join("\n")}

## 恢复

应用内更新失败时保留当前版本。请从本 Release 下载对应平台安装包；macOS 使用 DMG，Linux deb 用户下载匹配架构的 deb。不得覆盖同一 Tag 的既有资产，修复应发布更高补丁版本。
`

await writeFile(output, notes)

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
