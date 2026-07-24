import path from "node:path"
import { aggregateRelease, parseDesktopTag } from "./release-tools.mjs"

const tag = argument("tag")
const output = argument("output")
const rawInputs = repeatedArguments("input")
if (!tag || !output || rawInputs.length === 0) {
  throw new Error(
    "用法：node scripts/aggregate-release.mjs --tag <tag> --output <目录> --input <platform>:<arch>:<目录>",
  )
}

await aggregateRelease({
  expectedVersion: parseDesktopTag(tag),
  inputs: rawInputs.map((value) => {
    const [platform, arch, ...directory] = value.split(":")
    if (!platform || !arch || directory.length === 0) throw new Error(`聚合输入无效：${value}`)
    return { arch, directory: path.resolve(directory.join(":")), platform }
  }),
  outputDirectory: path.resolve(output),
})

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function repeatedArguments(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1])
      values.push(process.argv[index + 1])
  }
  return values
}
