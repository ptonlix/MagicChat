import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const desktopRoot = path.resolve(import.meta.dirname, "..")
const checkedRoots = [
  path.join(desktopRoot, "src"),
  path.join(desktopRoot, "public"),
]
const checkedFiles = [
  path.join(desktopRoot, "electron.vite.config.ts"),
  path.join(desktopRoot, "electron-builder.yml"),
  path.join(desktopRoot, "package.json"),
  path.join(desktopRoot, "tsconfig.json"),
  path.join(desktopRoot, "vitest.config.ts"),
]
const forbidden = [
  /client-web[\\/]src/,
  /client-web[\\/]public/,
  /\.\.[\\/]client-web/,
  /@magicchat[\\/]client-core/,
]

for (const root of checkedRoots) {
  for await (const file of walk(root)) checkedFiles.push(file)
}

const violations = []
for (const file of checkedFiles) {
  const content = await readFile(file, "utf8")
  for (const pattern of forbidden) {
    if (pattern.test(content)) violations.push(`${path.relative(desktopRoot, file)}: ${pattern}`)
  }
}

if (violations.length > 0) {
  console.error(`Desktop Renderer 边界检查失败：\n${violations.join("\n")}`)
  process.exitCode = 1
} else {
  console.log(`Desktop Renderer 边界检查通过（${checkedFiles.length} 个文件）`)
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Desktop 独立源码和资源禁止符号链接：${target}`)
    if (entry.isDirectory()) yield* walk(target)
    else if (/\.(?:css|html|js|json|mjs|ts|tsx|ya?ml)$/.test(entry.name)) yield target
  }
}
