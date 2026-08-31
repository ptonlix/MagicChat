import { execFile } from "node:child_process"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { APP_DISPLAY_NAME, STABLE_APP_ID } from "@main/app-identity"

const execute = promisify(execFile)
const CURRENT_APPLICATION_NAME = `${APP_DISPLAY_NAME}.app`
const LEGACY_APPLICATION_NAME = "MagicChat.app"

export type MacBrandMigrationResult = Readonly<{
  legacyApplications: readonly string[]
  status: "blocked" | "migrated" | "not-needed"
}>

type MacBrandMigrationOptions = Readonly<{
  applicationDirectories?: readonly string[]
  confirm: (legacyApplications: readonly string[]) => Promise<boolean>
  currentExecutablePath: string
  homePath: string
  isPackaged: boolean
  platform: NodeJS.Platform
  readBundleIdentifier?: (applicationPath: string) => Promise<string>
  trashItem: (applicationPath: string) => Promise<void>
}>

export async function migrateLegacyMacApplication(
  options: MacBrandMigrationOptions,
): Promise<MacBrandMigrationResult> {
  if (options.platform !== "darwin" || !options.isPackaged)
    return { legacyApplications: [], status: "not-needed" }

  const currentApplication = macApplicationBundlePath(options.currentExecutablePath)
  if (!currentApplication || path.basename(currentApplication) !== CURRENT_APPLICATION_NAME)
    return { legacyApplications: [], status: "not-needed" }

  const applicationDirectories = (
    options.applicationDirectories ?? ["/Applications", path.join(options.homePath, "Applications")]
  ).map((directory) => path.resolve(directory))
  if (!applicationDirectories.includes(path.dirname(path.resolve(currentApplication)))) {
    return { legacyApplications: [], status: "not-needed" }
  }

  const readBundleIdentifier = options.readBundleIdentifier ?? macBundleIdentifier
  const legacyApplications = await findLegacyApplications(
    applicationDirectories,
    readBundleIdentifier,
  )
  if (legacyApplications.length === 0) return { legacyApplications: [], status: "not-needed" }
  if (!(await options.confirm(legacyApplications))) {
    return { legacyApplications, status: "blocked" }
  }

  try {
    for (const applicationPath of legacyApplications) await options.trashItem(applicationPath)
    return { legacyApplications, status: "migrated" }
  } catch {
    return { legacyApplications, status: "blocked" }
  }
}

export function macApplicationBundlePath(executablePath: string): string | undefined {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`
  const markerIndex = executablePath.lastIndexOf(marker)
  if (markerIndex <= 0) return undefined
  const applicationPath = executablePath.slice(0, markerIndex)
  return applicationPath.endsWith(".app") ? applicationPath : undefined
}

async function findLegacyApplications(
  applicationDirectories: readonly string[],
  readBundleIdentifier: (applicationPath: string) => Promise<string>,
): Promise<string[]> {
  const legacyApplications: string[] = []
  for (const directory of new Set(applicationDirectories)) {
    const applicationPath = path.join(directory, LEGACY_APPLICATION_NAME)
    const state = await lstat(applicationPath).catch(() => undefined)
    if (!state?.isDirectory() || state.isSymbolicLink()) continue
    const identifier = await readBundleIdentifier(applicationPath).catch(() => undefined)
    if (identifier === STABLE_APP_ID) legacyApplications.push(applicationPath)
  }
  return legacyApplications
}

async function macBundleIdentifier(applicationPath: string): Promise<string> {
  const result = await execute("/usr/bin/plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    path.join(applicationPath, "Contents", "Info.plist"),
  ])
  return result.stdout.trim()
}
