const REQUIRED_KEYS = ["android", "ios", "windows", "macos", "linux-amd", "linux-arm"]

export function createDesktopVersionFile(base, { build, tag, version }) {
  validateVersionFile(base)
  if (!Number.isSafeInteger(build) || build <= 0) throw new Error("Desktop build 必须为正整数")
  if (tag !== `desktop-v${version}` || !isStableVersion(version)) {
    throw new Error("Desktop Tag 与版本不匹配")
  }
  const prefix = `https://github.com/ptonlix/MagicChat/releases/download/${tag}`
  const desktop = {
    windows: {
      build,
      version,
      url: `${prefix}/MagicChat-${version}-win-x64.exe`,
    },
    macos: {
      build,
      version,
      url: `${prefix}/MagicChat-${version}-mac-universal.dmg`,
    },
    "linux-amd": {
      build,
      version,
      url: `${prefix}/MagicChat-${version}-linux-x86_64.AppImage`,
    },
    "linux-arm": {
      build,
      version,
      url: `${prefix}/MagicChat-${version}-linux-arm64.AppImage`,
    },
  }
  const result = {
    ...structuredClone(base),
    ...desktop,
  }
  validateVersionFile(result)
  return result
}

export function validateVersionFile(value) {
  if (!isObject(value)) throw new Error("version.json 必须是 JSON 对象")
  for (const key of REQUIRED_KEYS) {
    if (!Object.hasOwn(value, key)) throw new Error(`version.json 缺少 ${key}`)
    validateEntry(value[key], key)
  }
  return value
}

function validateEntry(value, key) {
  if (!isObject(value)) throw new Error(`version.json ${key} 必须是对象`)
  if (!Number.isSafeInteger(value.build) || value.build <= 0) {
    throw new Error(`version.json ${key}.build 必须为正整数`)
  }
  if (!isStableVersion(value.version)) {
    throw new Error(`version.json ${key}.version 必须是 Stable SemVer`)
  }
  if (typeof value.url !== "string") throw new Error(`version.json ${key}.url 必须是 HTTPS URL`)
  let url
  try {
    url = new URL(value.url)
  } catch {
    throw new Error(`version.json ${key}.url 必须是 HTTPS URL`)
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`version.json ${key}.url 必须是 HTTPS URL`)
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isStableVersion(value) {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
}
