import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const builder = await readFile(path.join(root, "electron-builder.yml"), "utf8")
const viteConfig = await readFile(path.join(root, "electron.vite.config.ts"), "utf8")
const lockfile = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8")
const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8")
const html = await readFile(path.join(root, "out/renderer/index.html"), "utf8")
const main = await readFile(path.join(root, "out/main/index.js"), "utf8")
const preload = await readFile(path.join(root, "out/preload/index.cjs"), "utf8")
const rendererAssets = path.join(root, "out/renderer/assets")
const rendererCssName = (await readdir(rendererAssets)).find((name) => /^index-.+\.css$/.test(name))
assert(rendererCssName, "Renderer 缺少主样式产物")
const rendererCss = await readFile(path.join(rendererAssets, rendererCssName), "utf8")

assert(packageJson.version && packageJson.version !== "0.0.0", "应用版本无效")
assert(!workspace.includes("../client-web"), "Desktop workspace 不得接管 client-web 依赖")
assert(!/^  \.\.\/client-web:/m.test(lockfile), "Desktop 锁文件不得包含 client-web importer")
assert(/\bport:\s*20050\b/.test(viteConfig), "Desktop Renderer 调试端口必须为 20050")
assert(/\bstrictPort:\s*true\b/.test(viteConfig), "Desktop Renderer 调试端口必须禁止自动漂移")
for (const dependency of ["@dnd-kit/core", "harmonyos-sans-sc-webfont-splitted", "react-day-picker"]) {
  assert(packageJson.dependencies[dependency], `Desktop 缺少共享界面依赖 ${dependency}`)
}
assert(builder.includes("appId: com.magicchat.desktop"), "应用 ID 不正确")
assert(builder.includes("identity: null"), "POC macOS 构建必须保持未签名")
assert(html.includes("Content-Security-Policy"), "Renderer 缺少 CSP")
assert(!html.includes("http://localhost"), "生产 Renderer 包含开发服务器地址")
assert(main.includes("ELECTRON_RENDERER_URL"), "Main 缺少显式开发分支")
assert(main.includes("!app.isPackaged") || main.includes("!electron.app.isPackaged"), "开发地址没有受 packaged 条件保护")
assert(!/import\s*\{[^}]*autoUpdater[^}]*\}\s*from\s*["']electron-updater["']/.test(main), "Main 使用了不兼容 CommonJS 的 electron-updater 命名导入")
assert(/import\s+\w+\s+from\s+["']electron-updater["']/.test(main), "Main 缺少 electron-updater 默认导入")
assert((await stat(path.join(root, "out/preload/index.cjs"))).size > 0, "Preload 产物为空")
assert(preload.includes('require("electron")'), "沙箱 Preload 未使用 CommonJS 加载 Electron")
assert(!/^import\s/m.test(preload), "沙箱 Preload 包含不兼容的 ESM 导入")
for (const className of [".bg-background", ".flex", ".min-h-svh", ".text-muted-foreground"]) {
  assert(rendererCss.includes(className), `Renderer 缺少共享界面样式 ${className}`)
}

console.log(JSON.stringify({ appId: "com.magicchat.desktop", arch: process.arch, platform: process.platform, version: packageJson.version }))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
