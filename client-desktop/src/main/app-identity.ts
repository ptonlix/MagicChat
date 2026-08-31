import path from "node:path"

export const APP_DISPLAY_NAME = "即应"
export const RELEASE_ASSET_PREFIX = "Jiying"
export const STABLE_USER_DATA_DIRECTORY_NAME = "magicchat-desktop"
export const STABLE_UPDATER_CACHE_DIRECTORY_NAME = "magicchat-desktop-updater"

export function stableUserDataPath(appDataPath: string): string {
  return path.join(appDataPath, STABLE_USER_DATA_DIRECTORY_NAME)
}
