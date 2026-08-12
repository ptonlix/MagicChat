import { describe, expect, it } from "vitest"

import {
  normalizeDiagnosticProcessExitReason,
  parseDiagnosticEventInput,
  parseDiagnosticContext,
  type DiagnosticDataForType,
  type DiagnosticEventInput,
} from "@shared/diagnostics-contract"

describe("诊断事件契约", () => {
  it("保留经过校验的 conversationId 并将关联字段限制在 context", () => {
    const event = parseDiagnosticEventInput({
      context: {
        conversationId: "conversation-1",
        requestId: "request_1",
        syncOperationId: "sync-1",
      },
      data: { afterSeq: 42, endpoint: "message-after-seq" },
      origin: "renderer",
      type: "message-sync.page-requested",
    })

    expect(event.context).toEqual({
      conversationId: "conversation-1",
      requestId: "request_1",
      syncOperationId: "sync-1",
    })
    expect(event.data).toEqual({ afterSeq: 42, endpoint: "message-after-seq" })
  })

  it("拒绝空 context、未校验标识和自由文本 data", () => {
    expect(() => parseDiagnosticContext({})).toThrow("诊断事件字段无效")
    expect(() =>
      parseDiagnosticEventInput({
        context: { conversationId: "conversation with spaces" },
        origin: "renderer",
        type: "message-sync.started",
      }),
    ).toThrow("诊断事件字段无效")
    expect(() => parseDiagnosticEventInput(withData({ messageBody: "不应写入正文" }))).toThrow(
      "诊断事件字段无效",
    )
    expect(() =>
      parseDiagnosticEventInput(withData({ endpoint: "https://server.example/api?token=x" })),
    ).toThrow("诊断事件字段无效")
    expect(() =>
      parseDiagnosticEventInput(withData({ error: { category: "token", phase: "request" } })),
    ).toThrow("诊断事件字段无效")
  })

  it("拒绝错误 origin、自由 type 和 renderer 伪造的 main 事件", () => {
    expect(() =>
      parseDiagnosticEventInput({ origin: "ipc", type: "realtime.state-changed" }),
    ).toThrow("诊断事件字段无效")
    expect(() => parseDiagnosticEventInput({ origin: "renderer", type: "custom.debug" })).toThrow(
      "诊断事件字段无效",
    )
    expect(() =>
      parseDiagnosticEventInput(
        { origin: "main", type: "realtime.state-changed" },
        new Set(["renderer"]),
      ),
    ).toThrow("诊断事件字段无效")
  })

  it("按事件 type 限制 data 字段，并为生产端提供对应的静态约束", () => {
    expect(() =>
      parseDiagnosticEventInput({
        data: { afterSeq: 42 },
        origin: "renderer",
        type: "environment.network-changed",
      }),
    ).toThrow("诊断事件字段无效")
    expect(() =>
      parseDiagnosticEventInput({
        data: { endpoint: "conversation-list" },
        origin: "renderer",
        type: "message-sync.page-requested",
      }),
    ).toThrow("诊断事件字段无效")

    const pageRequestedData: DiagnosticDataForType<"message-sync.page-requested"> = {
      afterSeq: 42,
      endpoint: "message-after-seq",
    }
    expect(pageRequestedData).toEqual({ afterSeq: 42, endpoint: "message-after-seq" })

    const invalidPageRequestedData: DiagnosticDataForType<"message-sync.page-requested"> = {
      // @ts-expect-error 该字段属于 conversation-ui.state-observed，不属于分页请求事件。
      viewMode: "history",
    }
    void invalidPageRequestedData

    const invalidEndpointData: DiagnosticDataForType<"message-sync.page-requested"> = {
      // @ts-expect-error 分页请求只能使用 message-after-seq endpoint。
      endpoint: "conversation-list",
    }
    void invalidEndpointData

    const invalidCacheCommitted: DiagnosticEventInput<"message-sync.cache-committed"> = {
      // @ts-expect-error 缓存提交必须关联到具体分页请求。
      context: { conversationId: "conversation-1", syncOperationId: "sync-1" },
      // @ts-expect-error 缓存提交必须同时记录全部关键游标。
      data: { afterSeq: 42, committedSeq: 42 },
      origin: "renderer",
      type: "message-sync.cache-committed",
    }
    void invalidCacheCommitted

    // @ts-expect-error 状态事件必须携带完整的连接关联上下文。
    const invalidRealtimeState: DiagnosticEventInput<"realtime.state-changed"> = {
      data: { ready: false, status: "disconnected" },
      origin: "renderer",
      type: "realtime.state-changed",
    }
    void invalidRealtimeState
  })

  it("拒绝缺失状态字段或分页关联/游标的事件", () => {
    expect(() =>
      parseDiagnosticEventInput({
        data: { ready: true },
        origin: "renderer",
        type: "realtime.state-changed",
      }),
    ).toThrow("诊断事件字段无效")
    expect(() =>
      parseDiagnosticEventInput({
        data: { ready: true, status: "connected" },
        origin: "renderer",
        type: "realtime.state-changed",
      }),
    ).toThrow("诊断事件字段无效")
    expect(() =>
      parseDiagnosticEventInput({
        context: { conversationId: "conversation-1", syncOperationId: "sync-1" },
        data: { afterSeq: 42, cacheNewestSeq: 42, committedSeq: 42, memoryCursor: 42 },
        origin: "renderer",
        type: "message-sync.cache-committed",
      }),
    ).toThrow("诊断事件字段无效")
    expect(() =>
      parseDiagnosticEventInput({
        context: {
          conversationId: "conversation-1",
          requestId: "request-1",
          syncOperationId: "sync-1",
        },
        data: { afterSeq: 42 },
        origin: "renderer",
        type: "message-sync.cache-committed",
      }),
    ).toThrow("诊断事件字段无效")
  })

  it("将 Main 故障事件限制为预定义 type 与枚举字段", () => {
    const event = parseDiagnosticEventInput({
      data: { processExitReason: "crashed" },
      origin: "renderer",
      type: "renderer.process-gone",
    })
    expect(event).toMatchObject({
      data: { processExitReason: "crashed" },
      type: "renderer.process-gone",
    })
    expect(normalizeDiagnosticProcessExitReason("unexpected-value")).toBe("unknown")
    expect(() =>
      parseDiagnosticEventInput({
        data: { processExitReason: "free-text" },
        origin: "renderer",
        type: "renderer.process-gone",
      }),
    ).toThrow("诊断事件字段无效")
  })
})

function withData(data: Record<string, unknown>) {
  return {
    data,
    origin: "renderer",
    type: "message-sync.started",
  }
}
