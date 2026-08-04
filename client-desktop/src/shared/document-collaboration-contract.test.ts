// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  DOCUMENT_COLLABORATION_LIMITS,
  copyDocumentFrame,
  parseDocumentConnectionId,
  parseDocumentSessionId,
  parseDocumentUuid,
} from "./document-collaboration-contract"

describe("文档协作契约", () => {
  it("固定安全上限", () => {
    expect(DOCUMENT_COLLABORATION_LIMITS).toEqual({
      drainIntervalMs: 20,
      maxFrameBytes: 16 * 1024 * 1024,
      maxOwnerSessions: 8,
      maxQueueBytes: 32 * 1024 * 1024,
    })
    expect(Object.isFrozen(DOCUMENT_COLLABORATION_LIMITS)).toBe(true)
  })

  it("只接受 UUID 文档、v4 session 和连接标识", () => {
    expect(parseDocumentUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    )
    expect(() => parseDocumentUuid("https://example.com/document")).toThrow()
    expect(parseDocumentSessionId("550e8400-e29b-41d4-a716-446655440000")).toBeTruthy()
    expect(parseDocumentConnectionId("650e8400-e29b-41d4-a716-446655440000")).toBeTruthy()
    expect(() => parseDocumentSessionId("session-1")).toThrow()
    expect(() => parseDocumentConnectionId("connection-1")).toThrow()
  })

  it("复制二进制帧并拒绝字符串、对象与超限数据", () => {
    const source = new Uint8Array([1, 2, 3])
    const copy = copyDocumentFrame(source)
    source[0] = 9
    expect([...copy]).toEqual([1, 2, 3])
    expect(() => copyDocumentFrame("frame")).toThrow()
    expect(() => copyDocumentFrame({ data: [] })).toThrow()
    expect(() => copyDocumentFrame(new Uint8Array(16 * 1024 * 1024 + 1))).toThrow()
  })
})
