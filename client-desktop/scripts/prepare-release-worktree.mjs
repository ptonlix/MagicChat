import { execFile } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { parseDesktopTag, writePackageVersion } from "./release-version.mjs"

const execute = promisify(execFile)
const repository = path.resolve(import.meta.dirname, "../..")
const tag = argument("tag")
const target = path.resolve(argument("target") ?? "")
if (!tag || !target)
  throw new Error("用法：node scripts/prepare-release-worktree.mjs --tag <tag> --target <目录>")

const version = parseDesktopTag(tag)
const sourcePackage = path.join(repository, "client-desktop/package.json")
const sourceBefore = await readFile(sourcePackage, "utf8")
await rm(target, { recursive: true, force: true })
await execute("git", ["worktree", "add", "--detach", target, "HEAD"], { cwd: repository })
await writePackageVersion(path.join(target, "client-desktop/package.json"), version)
const sourceAfter = await readFile(sourcePackage, "utf8")
if (sourceAfter !== sourceBefore) throw new Error("版本注入修改了原始工作树")

console.log(
  JSON.stringify({
    desktopDirectory: path.join(target, "client-desktop"),
    version,
    worktree: target,
  }),
)

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
