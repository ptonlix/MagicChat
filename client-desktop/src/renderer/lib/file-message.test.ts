import { describe, expect, it } from "vitest"

import { fileMessageMaxBytes, getFileMessageUploadError } from "@/lib/file-message"

describe("file message validation", () => {
  it("rejects empty and oversized files", () => {
    expect(getFileMessageUploadError({ size: 0 })).toBe("文件不能为空")
    expect(getFileMessageUploadError({ size: fileMessageMaxBytes + 1 })).toBe("文件不能超过 200MiB")
  })

  it("accepts files through the 200 MiB boundary", () => {
    expect(getFileMessageUploadError({ size: 1 })).toBeNull()
    expect(getFileMessageUploadError({ size: 20 * 1024 * 1024 + 1 })).toBeNull()
    expect(getFileMessageUploadError({ size: fileMessageMaxBytes })).toBeNull()
  })
})
