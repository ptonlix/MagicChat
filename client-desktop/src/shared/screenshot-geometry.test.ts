import { describe, expect, it } from "vitest"
import {
  clampSelection,
  createSelection,
  cssPointToImage,
  moveSelection,
  resizeSelection,
} from "@shared/screenshot-geometry"

describe("screenshot geometry", () => {
  it("normalizes a reverse drag", () => {
    expect(createSelection({ x: 90, y: 70 }, { x: 10, y: 20 })).toEqual({
      height: 50,
      width: 80,
      x: 10,
      y: 20,
    })
  })

  it("clamps selection size and position to the image", () => {
    expect(clampSelection({ height: 120, width: 130, x: -20, y: 40 }, 100, 80, 8)).toEqual({
      height: 80,
      width: 100,
      x: 0,
      y: 0,
    })
  })

  it("moves a selection without crossing image edges", () => {
    expect(
      moveSelection({ height: 20, width: 30, x: 10, y: 10 }, { x: 100, y: -50 }, 80, 60),
    ).toEqual({
      height: 20,
      width: 30,
      x: 50,
      y: 0,
    })
  })

  it.each(["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const)(
    "resizes from the %s handle while preserving the minimum",
    (handle) => {
      const resized = resizeSelection(
        { height: 30, width: 40, x: 20, y: 20 },
        handle,
        { x: 100, y: 100 },
        100,
        90,
        8,
      )
      expect(resized.width).toBeGreaterThanOrEqual(8)
      expect(resized.height).toBeGreaterThanOrEqual(8)
      expect(resized.x).toBeGreaterThanOrEqual(0)
      expect(resized.y).toBeGreaterThanOrEqual(0)
      expect(resized.x + resized.width).toBeLessThanOrEqual(100)
      expect(resized.y + resized.height).toBeLessThanOrEqual(90)
    },
  )

  it("converts CSS pixels with the actual image ratios", () => {
    expect(cssPointToImage({ x: 300, y: 200 }, 600, 400, 1800, 1200)).toEqual({
      x: 900,
      y: 600,
    })
  })
})
