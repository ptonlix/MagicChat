const REQUIRED_KEYS = ["android", "ios", "windows", "macos", "linux-amd", "linux-arm"]
const DESKTOP_KEYS = ["windows", "macos", "linux-amd", "linux-arm"]
const OFFICIAL_PACKAGE_PATHS = {
  windows: "/releases/jiying.exe",
  macos: "/releases/jiying.dmg",
  "linux-amd": "/releases/jiying.amd.AppImage",
  "linux-arm": "/releases/jiying.arm.AppImage",
}

export function createDesktopVersionFile(base, { build, integrity, tag, version }) {
  validateVersionBase(base)
  if (!Number.isSafeInteger(build) || build <= 0) throw new Error("Desktop build 必须为正整数")
  if (tag !== `desktop-v${version}` || !isStableVersion(version)) {
    throw new Error("Desktop Tag 与版本不匹配")
  }
  if (!isObject(integrity)) throw new Error("Desktop 安装包完整性元数据无效")
  const prefix = `https://github.com/ptonlix/MagicChat/releases/download/${tag}`
  const fileNames = desktopPackageFileNames(version)
  const desktop = {
    windows: {
      build,
      ...integrity.windows,
      version,
      url: `${prefix}/${fileNames.windows}`,
    },
    macos: {
      build,
      ...integrity.macos,
      version,
      url: `${prefix}/${fileNames.macos}`,
    },
    "linux-amd": {
      build,
      ...integrity["linux-amd"],
      version,
      url: `${prefix}/${fileNames["linux-amd"]}`,
    },
    "linux-arm": {
      build,
      ...integrity["linux-arm"],
      version,
      url: `${prefix}/${fileNames["linux-arm"]}`,
    },
  }
  const result = {
    ...structuredClone(base),
    ...desktop,
  }
  validateVersionFile(result)
  return result
}

export function desktopPackageFileNames(version) {
  if (!isStableVersion(version)) throw new Error("Desktop 版本必须是 Stable SemVer")
  return {
    windows: `Jiying-${version}-win-x64.exe`,
    macos: `Jiying-${version}-mac-universal.dmg`,
    "linux-amd": `Jiying-${version}-linux-x86_64.AppImage`,
    "linux-arm": `Jiying-${version}-linux-arm64.AppImage`,
  }
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
  if (DESKTOP_KEYS.includes(key)) {
    if (!isAllowedDesktopPackageUrl(url, key, value.version)) {
      throw new Error(`version.json ${key}.url 不是受信任发布地址`)
    }
    if (!Number.isSafeInteger(value.size) || value.size <= 0) {
      throw new Error(`version.json ${key}.size 必须为正整数`)
    }
    if (typeof value.sha512 !== "string" || !isSha512(value.sha512)) {
      throw new Error(`version.json ${key}.sha512 必须是 SHA-512 Base64`)
    }
  }
}

function validateVersionBase(value) {
  if (!isObject(value)) throw new Error("version.json 必须是 JSON 对象")
  for (const key of REQUIRED_KEYS) {
    if (!Object.hasOwn(value, key)) throw new Error(`version.json 缺少 ${key}`)
    if (DESKTOP_KEYS.includes(key)) continue
    validateEntry(value[key], key)
  }
}

function isAllowedDesktopPackageUrl(url, key, version) {
  if (url.port || url.hash || url.search) return false
  if (url.origin === "https://jiying.chat") return url.pathname === OFFICIAL_PACKAGE_PATHS[key]
  if (url.origin !== "https://github.com") return false
  return (
    url.pathname ===
    `/ptonlix/MagicChat/releases/download/desktop-v${version}/${desktopPackageFileNames(version)[key]}`
  )
}

function isSha512(value) {
  try {
    const decoded = Buffer.from(value, "base64")
    return decoded.byteLength === 64 && decoded.toString("base64") === value
  } catch {
    return false
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isStableVersion(value) {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
}
