export type UpdateInstallMode = "manual" | "ota" | "unsupported"
export type UpdateInstallationSource =
  | "appimage"
  | "deb"
  | "development"
  | "mac_app"
  | "nsis"
  | "unknown"

export type UpdateEligibilityInput = Readonly<{
  appImagePath?: string
  arch: string
  channel: "preview" | "stable" | "test"
  packaged: boolean
  platform: NodeJS.Platform
}>

export type UpdateEligibility = Readonly<{
  canCheck: boolean
  installationSource: UpdateInstallationSource
  mode: UpdateInstallMode
}>

export function determineUpdateEligibility(input: UpdateEligibilityInput): UpdateEligibility {
  if (!isSupportedPlatform(input.platform) || !isSupportedArch(input.arch)) {
    return { canCheck: false, installationSource: "unknown", mode: "unsupported" }
  }
  if (!input.packaged) {
    return { canCheck: false, installationSource: "development", mode: "manual" }
  }
  if (input.channel !== "stable") {
    return { canCheck: false, installationSource: platformSource(input.platform), mode: "manual" }
  }
  if (input.platform === "linux") {
    return input.appImagePath
      ? { canCheck: true, installationSource: "appimage", mode: "ota" }
      : { canCheck: true, installationSource: "deb", mode: "manual" }
  }
  return {
    canCheck: true,
    installationSource: input.platform === "win32" ? "nsis" : "mac_app",
    mode: "ota",
  }
}

function isSupportedPlatform(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "darwin" || platform === "linux"
}

function isSupportedArch(arch: string): boolean {
  return arch === "x64" || arch === "arm64"
}

function platformSource(platform: NodeJS.Platform): UpdateInstallationSource {
  if (platform === "win32") return "nsis"
  if (platform === "darwin") return "mac_app"
  if (platform === "linux") return "deb"
  return "unknown"
}
