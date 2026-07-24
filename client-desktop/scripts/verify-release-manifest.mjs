import path from "node:path"
import { parseDesktopTag, validateManifest } from "./release-tools.mjs"

const tag = argument("tag")
const manifest = argument("manifest")
const platform = argument("platform")
const arch = argument("arch")
const artifacts = argument("artifacts")
if (!tag || !manifest || !platform || !arch || !artifacts) {
  throw new Error("缺少 --tag、--manifest、--platform、--arch 或 --artifacts")
}

await validateManifest({
  arch,
  artifactDirectory: path.resolve(artifacts),
  expectedVersion: parseDesktopTag(tag),
  manifestPath: path.resolve(manifest),
  platform,
})

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
