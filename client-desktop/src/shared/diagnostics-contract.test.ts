import { describe, expect, it } from "vitest"

import {
  parseDiagnosticEventInput,
  parseDiagnosticContext,
  type DiagnosticDataForType,
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
  })
})

function withData(data: Record<string, unknown>) {
  return {
    data,
    origin: "renderer",
    type: "message-sync.started",
  }
}
