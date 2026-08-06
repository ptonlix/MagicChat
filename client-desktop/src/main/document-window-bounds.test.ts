import { describe, expect, it } from "vitest"

import {
  clampDocumentWindowBounds,
  defaultDocumentWindowBounds,
  resolveDocumentWindowBounds,
} from "@main/document-window-bounds"

const workArea = { height: 820, width: 1280, x: 0, y: 0 }

describe("文档窗口 bounds", () => {
  it("首次打开定位到主窗口右侧并保持最小可用尺寸", () => {
    const bounds = defaultDocumentWindowBounds(workArea, { height: 820, width: 600, x: 0, y: 0 })
    expect(bounds).toEqual({ height: 760, width: 1120, x: 160, y: 0 })
    expect(bounds.width).toBeGreaterThanOrEqual(760)
    expect(bounds.height).toBeGreaterThanOrEqual(560)
  })

  it("将超出 workArea 的状态夹紧到可见区域", () => {
    expect(
      clampDocumentWindowBounds({ height: 640, width: 900, x: 2000, y: -400 }, workArea),
    ).toEqual({
      height: 640,
      width: 900,
      x: 380,
      y: 0,
    })
  })

  it("完全离屏、损坏或过小的状态回退到安全默认位置", () => {
    expect(
      resolveDocumentWindowBounds({ height: 640, width: 900, x: 2000, y: 0 }, workArea),
    ).toEqual(defaultDocumentWindowBounds(workArea))
    expect(resolveDocumentWindowBounds(undefined, workArea)).toEqual(
      defaultDocumentWindowBounds(workArea),
    )
  })
})
