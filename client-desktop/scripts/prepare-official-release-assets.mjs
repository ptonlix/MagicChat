import path from "node:path"
import { prepareOfficialReleaseAssets } from "./official-release-assets.mjs"

const inputDirectory = path.resolve(argument("input") ?? "")
const outputDirectory = path.resolve(argument("output") ?? "")
if (!argument("input") || !argument("output")) {
  throw new Error(
    "用法：node scripts/prepare-official-release-assets.mjs --input <Release 资产目录> --output <官网上传目录>",
  )
}

console.log(JSON.stringify(await prepareOfficialReleaseAssets({ inputDirectory, outputDirectory })))

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
