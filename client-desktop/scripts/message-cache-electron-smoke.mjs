import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { spawn } from "node:child_process"

if (process.env.MAGICCHAT_ELECTRON_WORKER_SMOKE !== "1") {
  const { default: electronPath } = await import("electron")
  const { createPackage } = await import("@electron/asar")
  const packageDirectory = await mkdtemp(path.join(os.tmpdir(), "magicchat-asar-smoke-"))
  try {
    const asarPath = path.join(packageDirectory, "app.asar")
    await createPackage(path.resolve(import.meta.dirname, "../out"), asarPath)
    for (const workerPath of [
      path.resolve(import.meta.dirname, "../out/main/message-cache-worker.js"),
      path.join(asarPath, "main/message-cache-worker.js"),
    ]) {
      const child = spawn(electronPath, [import.meta.filename], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          MAGICCHAT_ELECTRON_WORKER_PATH: workerPath,
          MAGICCHAT_ELECTRON_WORKER_SMOKE: "1",
        },
        stdio: "inherit",
      })
      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject)
        child.once("exit", (code) => resolve(code ?? 1))
      })
      if (exitCode !== 0) throw new Error(`消息缓存 Worker smoke test 退出码 ${exitCode}`)
    }
  } finally {
    await rm(packageDirectory, { force: true, recursive: true })
  }
} else {
  await runSmokeTest()
}

async function runSmokeTest() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-electron-cache-"))
  const workerPath = process.env.MAGICCHAT_ELECTRON_WORKER_PATH
  if (!workerPath) throw new Error("消息缓存 Worker 路径缺失")
  const databasePath = path.join(directory, "messages.sqlite3")

  try {
    const worker = new Worker(workerPath, { workerData: { databasePath } })
    const request = (id, operation) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("消息缓存 Worker smoke test 超时")), 5000)
        const onMessage = (response) => {
          if (response.id !== id) return
          clearTimeout(timeout)
          worker.off("message", onMessage)
          if (response.errorCode) reject(new Error(`消息缓存 Worker 返回 ${response.errorCode}`))
          else resolve(response.result)
        }
        worker.on("message", onMessage)
        worker.postMessage({ id, operation })
      })

    const health = await request(1, { kind: "health" })
    await request(2, { kind: "shutdown" })
    await worker.terminate()
    if (health?.status !== "available") throw new Error("消息缓存 Worker 未进入 available")
    console.log(
      JSON.stringify({ electron: process.versions.electron, node: process.versions.node }),
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}
