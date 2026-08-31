export const DESKTOP_VERSION_MANIFEST_URL = "https://jiying.chat/releases/version.json"

export type DesktopVersionKey = "linux-amd" | "linux-arm" | "macos" | "windows"

export type DesktopVersionEntry = Readonly<{
  build: number
  sha512?: string
  size?: number
  url: string
  version: string
}>

export function selectDesktopVersionEntry(
  value: unknown,
  platform: NodeJS.Platform,
  arch: string,
): DesktopVersionEntry | undefined {
  const key = desktopVersionKey(platform, arch)
  if (!key) return undefined
  if (!isObject(value) || !(key in value)) throw new Error(`metadata missing ${key}`)
  return parseDesktopVersionEntry(value[key], key)
}

export function desktopVersionKey(
  platform: NodeJS.Platform,
  arch: string,
): DesktopVersionKey | undefined {
  if (platform === "win32") return arch === "x64" ? "windows" : undefined
  if (platform === "darwin") return arch === "x64" || arch === "arm64" ? "macos" : undefined
  if (platform === "linux") {
    if (arch === "x64") return "linux-amd"
    if (arch === "arm64") return "linux-arm"
  }
  return undefined
}

export function compareStableVersions(left: string, right: string): number {
  const leftParts = stableVersionParts(left)
  const rightParts = stableVersionParts(right)
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

export function isStableVersion(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
}

function parseDesktopVersionEntry(value: unknown, key: DesktopVersionKey): DesktopVersionEntry {
  if (!isObject(value)) throw new Error(`metadata invalid ${key}`)
  const { build, sha512, size, url, version } = value
  if (!Number.isSafeInteger(build) || (build as number) <= 0) {
    throw new Error(`metadata invalid ${key} build`)
  }
  if (!isStableVersion(version)) throw new Error(`metadata invalid ${key} version`)
  if (typeof url !== "string" || !isAllowedPackageUrl(url, key)) {
    throw new Error(`metadata invalid ${key} url`)
  }
  if (size !== undefined && (!Number.isSafeInteger(size) || (size as number) <= 0)) {
    throw new Error(`metadata invalid ${key} size`)
  }
  if (sha512 !== undefined && (typeof sha512 !== "string" || !isSha512(sha512))) {
    throw new Error(`metadata invalid ${key} sha512`)
  }
  return {
    build: build as number,
    ...(sha512 === undefined ? {} : { sha512 }),
    ...(size === undefined ? {} : { size: size as number }),
    url,
    version,
  }
}

function isAllowedPackageUrl(value: string, key: DesktopVersionKey): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || url.username || url.password) return false
  const pathname = decodeURIComponent(url.pathname)
  if (key === "windows") return pathname.toLowerCase().endsWith(".exe")
  if (key === "macos") return pathname.toLowerCase().endsWith(".dmg")
  return pathname.toLowerCase().endsWith(".appimage")
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isSha512(value: string): boolean {
  try {
    const decoded = Buffer.from(value, "base64")
    return decoded.byteLength === 64 && decoded.toString("base64") === value
  } catch {
    return false
  }
}

function stableVersionParts(value: string): [number, number, number] {
  if (!isStableVersion(value)) throw new Error(`metadata invalid version: ${value}`)
  return value.split(".").map(Number) as [number, number, number]
}
