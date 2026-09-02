import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { parseDesktopTag } from "./release-version.mjs"

const DESKTOP_KEYS = ["windows", "macos", "linux-amd", "linux-arm"]
const execute = promisify(execFile)

export async function readDesktopReleaseBuild(filePath) {
  let value
  try {
    value = JSON.parse(await readFile(filePath, "utf8"))
  } catch {
    throw new Error("Desktop release version base 文件无效")
  }

  return desktopReleaseBuildFromVersionBase(value)
}

export function desktopReleaseBuildFromVersionBase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Desktop release version base 必须是对象")
  }

  const builds = DESKTOP_KEYS.map((key) => value[key]?.build)
  if (builds.some((build) => !Number.isSafeInteger(build) || build <= 0)) {
    throw new Error("Desktop release version base 中各平台 build 必须是正整数")
  }
  if (new Set(builds).size !== 1) {
    throw new Error("Desktop release version base 中各平台 build 必须一致")
  }
  return builds[0]
}

export function assertDesktopBuildIncreases(currentBuild, previousBuild, previousTag) {
  if (!Number.isSafeInteger(currentBuild) || currentBuild <= 0) {
    throw new Error("Desktop build 必须是正整数")
  }
  if (previousBuild === undefined) return
  if (!Number.isSafeInteger(previousBuild) || previousBuild <= 0) {
    throw new Error("上一正式 Desktop build 无效")
  }
  if (currentBuild <= previousBuild) {
    const suffix = typeof previousTag === "string" && previousTag ? `（${previousTag}）` : ""
    throw new Error(
      `Desktop build 必须严格大于上一正式版本 ${previousBuild}${suffix}，当前为 ${currentBuild}`,
    )
  }
}

export async function readPreviousDesktopReleaseBuild({ currentTag, repository }) {
  parseDesktopTag(currentTag)
  let previous
  for (const tag of await listOfficialDesktopTags(repository)) {
    if (tag === currentTag) continue
    const build = await readTagDesktopBuild(repository, tag)
    if (build === undefined) continue
    if (previous === undefined || build > previous.build) previous = { build, tag }
  }
  return previous
}

async function listOfficialDesktopTags(repository) {
  const { stdout } = await execute("git", ["tag", "-l", "desktop-v*"], {
    cwd: repository,
    encoding: "utf8",
  })
  const tags = []
  for (const line of stdout.split("\n")) {
    const tag = line.trim()
    if (!tag) continue
    try {
      parseDesktopTag(tag)
    } catch {
      continue
    }
    const objectType = await git(repository, ["cat-file", "-t", `refs/tags/${tag}`]).catch(() => "")
    if (objectType === "tag") tags.push(tag)
  }
  return tags
}

async function readTagDesktopBuild(repository, tag) {
  let contents
  try {
    contents = await git(repository, [
      "show",
      `${tag}^{commit}:client-desktop/release-version-base.json`,
    ])
  } catch {
    return undefined
  }
  try {
    return desktopReleaseBuildFromVersionBase(JSON.parse(contents))
  } catch {
    return undefined
  }
}

async function git(repository, arguments_) {
  const { stdout } = await execute("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}
