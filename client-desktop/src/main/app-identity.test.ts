import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  APP_DISPLAY_NAME,
  RELEASE_ASSET_PREFIX,
  stableUserDataPath,
  STABLE_UPDATER_CACHE_DIRECTORY_NAME,
  STABLE_USER_DATA_DIRECTORY_NAME,
} from "@main/app-identity"

describe("桌面应用身份", () => {
  it("更换展示品牌时保留历史数据与更新缓存目录", () => {
    expect(APP_DISPLAY_NAME).toBe("即应")
    expect(RELEASE_ASSET_PREFIX).toBe("Jiying")
    expect(STABLE_USER_DATA_DIRECTORY_NAME).toBe("magicchat-desktop")
    expect(STABLE_UPDATER_CACHE_DIRECTORY_NAME).toBe("magicchat-desktop-updater")
    expect(stableUserDataPath(path.join("", "application-data"))).toBe(
      path.join("application-data", "magicchat-desktop"),
    )
  })
})
