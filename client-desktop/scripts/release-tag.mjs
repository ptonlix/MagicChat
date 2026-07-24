import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parseDesktopTag } from "./release-version.mjs"

const execute = promisify(execFile)
export const MAX_RELEASE_NOTES_LENGTH = 32 * 1024

export function validateReleaseNotes(notes) {
  if (typeof notes !== "string") throw new Error("Annotated Tag 正文无效")
  const normalized = notes
    .replace(/\r\n?/g, "\n")
    .replace(/\n-----BEGIN (?:PGP|SSH) SIGNATURE-----[\s\S]*$/, "")
    .trim()
  if (!normalized) throw new Error("Annotated Tag 正文不能为空")
  if (normalized.length > MAX_RELEASE_NOTES_LENGTH) {
    throw new Error(`Annotated Tag 正文不得超过 ${MAX_RELEASE_NOTES_LENGTH} 个字符`)
  }
  if (/[^\P{Cc}\n\t]/u.test(normalized)) throw new Error("Annotated Tag 正文包含控制字符")
  return normalized
}

export async function inspectReleaseTag({ expectedCommit, repository, tag }) {
  const version = parseDesktopTag(tag)
  const objectType = await git(repository, ["cat-file", "-t", `refs/tags/${tag}`]).catch(() => "")
  if (objectType !== "tag") throw new Error(`Stable Tag 必须是 Annotated 或 signed Tag：${tag}`)
  const commit = await git(repository, ["rev-parse", `${tag}^{commit}`])
  if (expectedCommit) {
    const expected = await git(repository, ["rev-parse", `${expectedCommit}^{commit}`])
    if (commit !== expected)
      throw new Error(`Tag Commit 与 checkout 不一致：${commit} != ${expected}`)
  }
  const notes = validateReleaseNotes(
    await git(repository, ["for-each-ref", "--format=%(contents)", `refs/tags/${tag}`], false),
  )
  const releaseDate = new Date(
    await git(repository, [
      "for-each-ref",
      "--format=%(taggerdate:iso-strict)",
      `refs/tags/${tag}`,
    ]),
  ).toISOString()
  return { commit, notes, objectType, releaseDate, tag, version }
}

async function git(repository, arguments_, trim = true) {
  const { stdout } = await execute("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: MAX_RELEASE_NOTES_LENGTH * 2,
  })
  return trim ? stdout.trim() : stdout
}
