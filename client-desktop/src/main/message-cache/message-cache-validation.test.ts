// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { MESSAGE_CACHE_LIMITS } from "@shared/message-cache-contract"
import {
  parseMessageCacheCommit,
  parseMessageCacheRecords,
  parseMessageCacheScope,
} from "./message-cache-validation"

const scope = {
  conversationId: "conversation-1",
  target: { id: "server-1", normalizedUrl: "https://chat.example.com", userId: "user-1" },
}

describe("消息缓存 IPC 输入校验", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("原子拒绝混合会话、畸形 JSON 和重复 seq", () => {
    expect(() =>
      parseMessageCacheRecords(
        [record(1), { ...record(2), conversationId: "conversation-2" }],
        scope,
      ),
    ).toThrow("请求无效")
    expect(() => parseMessageCacheRecords([{ ...record(1), payloadJson: "{" }], scope)).toThrow(
      "请求无效",
    )
    expect(() => parseMessageCacheRecords([record(1), { ...record(2), seq: 1 }], scope)).toThrow(
      "请求无效",
    )
  })

  it("拒绝超限 payload、未规范化 URL 和缺少 after 游标的错误由服务层阻断", () => {
    expect(() =>
      parseMessageCacheRecords(
        [
          {
            ...record(1),
            payloadJson: JSON.stringify("x".repeat(MESSAGE_CACHE_LIMITS.maxPayloadBytes)),
          },
        ],
        scope,
      ),
    ).toThrow("请求无效")
    expect(() =>
      parseMessageCacheScope({
        ...scope,
        target: { ...scope.target, normalizedUrl: "https://chat.example.com/" },
      }),
    ).toThrow("请求无效")
    expect(
      parseMessageCacheCommit(
        {
          generation: { conversation: 0, global: 0, server: 0, user: 0 },
          hasMoreBefore: true,
          records: [],
        },
        scope,
      ).requestAfterSeq,
    ).toBeUndefined()
  })

  it("generation 必须包含显式 global 层级", () => {
    expect(() =>
      parseMessageCacheCommit(
        { generation: { conversation: 0, server: 0, user: 0 }, hasMoreBefore: true, records: [] },
        scope,
      ),
    ).toThrow("请求无效")
    expect(
      parseMessageCacheCommit(
        {
          generation: { conversation: 0, global: 0, server: 0, user: 0 },
          hasMoreBefore: true,
          records: [],
        },
        scope,
      ).generation,
    ).toEqual({ conversation: 0, global: 0, server: 0, user: 0 })
  })

  it("开发环境允许本地 HTTP 服务端，仍拒绝远程 HTTP 服务端", () => {
    vi.stubEnv("NODE_ENV", "development")

    expect(
      parseMessageCacheScope({
        ...scope,
        target: { ...scope.target, normalizedUrl: "http://localhost:20080" },
      }),
    ).toMatchObject({ target: { normalizedUrl: "http://localhost:20080" } })
    expect(() =>
      parseMessageCacheScope({
        ...scope,
        target: { ...scope.target, normalizedUrl: "http://chat.example.com" },
      }),
    ).toThrow()
  })
})

function record(seq: number) {
  return {
    cachedAt: 1,
    conversationId: "conversation-1",
    createdAt: "2026-07-29T00:00:00Z",
    messageId: `message-${seq}`,
    payloadJson: JSON.stringify({ id: `message-${seq}` }),
    payloadSchemaVersion: 1,
    reactionVersion: 0,
    seq,
  }
}
