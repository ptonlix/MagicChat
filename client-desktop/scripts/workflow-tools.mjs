import { readFile } from "node:fs/promises"
import { JSON_SCHEMA, load } from "js-yaml"

export async function readWorkflow(workflowPath) {
  const workflow = load(await readFile(workflowPath, "utf8"), { schema: JSON_SCHEMA })
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error("Desktop Release 工作流必须是 YAML 对象")
  }
  return workflow
}

export function validateDesktopReleaseWorkflow(workflow) {
  assert(workflow.permissions?.contents === "read", "工作流默认权限必须是 contents: read")
  assert(
    workflow.concurrency?.group?.includes("${{ github.ref }}"),
    "concurrency 必须使用完整 Tag ref",
  )
  assert(workflow.concurrency?.["cancel-in-progress"] === false, "不得取消进行中的同 Tag 发布")
  const jobs = workflow.jobs
  assert(
    jobs && Object.keys(jobs).sort().join(",") === "package,quality,release",
    "Job 拓扑必须为 quality/package/release",
  )
  assert(jobs.package.needs === "quality", "package 必须依赖 quality")
  assert(
    Array.isArray(jobs.release.needs) &&
      jobs.release.needs.includes("package") &&
      jobs.release.needs.includes("quality"),
    "release 必须依赖 quality 和 package",
  )
  assert(
    jobs.release.permissions?.contents === "write",
    "只有 release Job 可以取得 contents: write",
  )
  assert(
    jobs.quality.permissions?.contents !== "write" &&
      jobs.package.permissions?.contents !== "write",
    "quality/package 不得取得 Release 写权限",
  )

  const qualityCommands = commands(jobs.quality)
  for (const command of ["pnpm check", "pnpm test", "pnpm build", "pnpm verify:build"]) {
    assert(qualityCommands.includes(command), `quality 缺少命令：${command}`)
  }
  const packageCommands = commands(jobs.package)
  assert(
    !/pnpm (?:check|test|lint|typecheck|verify:boundaries)/.test(packageCommands),
    "package 重复执行平台无关门禁",
  )
  for (const command of [
    "pnpm build",
    "pnpm verify:build",
    "electron-builder",
    "pnpm verify:package",
  ]) {
    assert(packageCommands.includes(command), `package 缺少命令：${command}`)
  }
  const releaseCommands = commands(jobs.release)
  assert(releaseCommands.includes("release:prepare-assets"), "release 必须使用单一资产准备入口")
  assert(releaseCommands.includes("release:publish"), "release 必须使用 Draft 发布事务")
  assert(!releaseCommands.includes("gh release delete"), "禁止按 Tag 删除 Release")
  assert(!releaseCommands.includes("release-assets/*"), "禁止通过通配符上传 Release 资产")
  return workflow
}

function commands(job) {
  return (job.steps ?? []).map((step) => step.run ?? "").join("\n")
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
