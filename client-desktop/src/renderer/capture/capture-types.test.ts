import { describe, expect, it } from "vitest"
import {
  commitAnnotation,
  deleteAnnotation,
  emptyAnnotationHistory,
  redoAnnotationHistory,
  undoAnnotationHistory,
  type ScreenshotAnnotation,
} from "./capture-types"

const rectangle: ScreenshotAnnotation = {
  color: "#ef4444",
  height: 20,
  id: "rectangle-1",
  kind: "rectangle",
  lineWidth: 3,
  width: 30,
  x: 10,
  y: 10,
}

describe("截图标注历史", () => {
  it("提交、撤销和重做保持不可变历史", () => {
    const committed = commitAnnotation(emptyAnnotationHistory, rectangle)
    expect(emptyAnnotationHistory.present).toHaveLength(0)
    expect(committed.present).toEqual([rectangle])

    const undone = undoAnnotationHistory(committed)
    expect(undone.present).toEqual([])
    expect(undone.future).toEqual([[rectangle]])
    expect(redoAnnotationHistory(undone)).toEqual(committed)
  })

  it("删除选中标注并清空重做栈，未知标识保持原状态", () => {
    const committed = commitAnnotation(emptyAnnotationHistory, rectangle)
    const deleted = deleteAnnotation(committed, rectangle.id)
    expect(deleted.present).toEqual([])
    expect(deleted.future).toEqual([])
    expect(deleteAnnotation(committed, "missing")).toBe(committed)
  })
})
