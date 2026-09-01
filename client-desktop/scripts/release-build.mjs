import { readFile } from "node:fs/promises"

const DESKTOP_KEYS = ["windows", "macos", "linux-amd", "linux-arm"]

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
