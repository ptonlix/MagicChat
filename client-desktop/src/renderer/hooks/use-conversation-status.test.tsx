import * as React from "react"
import { act, render, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useConversationStatus } from "@/hooks/use-conversation-status"
import { RealtimeContext, type RealtimeContextValue } from "@/lib/realtime-context"

const mocks = vi.hoisted(() => ({
  normalizeMessageCreatedEventPayload: vi.fn((payload: unknown) => payload),
  recordRealtimeParseFailure: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return {
    ...actual,
    normalizeMessageCreatedEventPayload: mocks.normalizeMessageCreatedEventPayload,
  }
})
vi.mock("@/lib/desktop-diagnostics", () => ({
  recordRealtimeParseFailure: mocks.recordRealtimeParseFailure,
}))

type Handler = (payload: unknown) => void

const conversationOneId = "550e8400-e29b-41d4-a716-446655440000"
const conversationTwoId = "650e8400-e29b-41d4-a716-446655440000"

function setup(supported = true) {
  const handlers = new Map<string, Handler>()
  const sendRealtimeRequest = vi.fn().mockResolvedValue(undefined)
  const value: RealtimeContextValue = {
    ready: true,
    status: "connected",
    sendRealtimeRequest,
    subscribeRealtimeEvent: vi.fn((name, handler) => {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    }),
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  )
  const hook = renderHook(
    ({ enabled, conversationId }) => useConversationStatus({ conversationId, supported: enabled }),
    {
      initialProps: { enabled: supported, conversationId: conversationOneId },
      wrapper,
    },
  )
  return { ...hook, handlers, realtime: value, sendRealtimeRequest }
}

function emitStatus(handlers: Map<string, Handler>, status = "正在输入") {
  act(() =>
    handlers.get("conversation.status")?.({
      conversation_id: conversationOneId,
      status,
      sender: { id: "user-2", type: "user" },
    }),
  )
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  })
  act(() => document.dispatchEvent(new Event("visibilitychange")))
}

describe("useConversationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.normalizeMessageCreatedEventPayload.mockImplementation((payload: unknown) => payload)
    vi.useFakeTimers()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it("五秒后自动清除收到的状态", () => {
    const { result, handlers } = setup()
    emitStatus(handlers, "处理中")
    expect(result.current.status).toBe("处理中")
    act(() => vi.advanceTimersByTime(4_999))
    expect(result.current.status).toBe("处理中")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.status).toBeUndefined()
  })

  it("收到同一会话的新状态时刷新过期时间", () => {
    const { result, handlers } = setup()
    emitStatus(handlers, "第一条")
    act(() => vi.advanceTimersByTime(4_000))
    emitStatus(handlers, "第二条")
    act(() => vi.advanceTimersByTime(4_999))
    expect(result.current.status).toBe("第二条")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.status).toBeUndefined()
  })

  it("同一发送方的新消息抵达时立即清除状态", () => {
    const { result, handlers } = setup()
    emitStatus(handlers)
    act(() =>
      handlers.get("message.created")?.({
        conversationId: conversationOneId,
        sender: { id: "user-2", type: "user" },
      }),
    )
    expect(result.current.status).toBeUndefined()
  })

  it("忽略超长或发送方类型不合法的状态事件", () => {
    const { result, handlers } = setup()
    act(() =>
      handlers.get("conversation.status")?.({
        conversation_id: conversationOneId,
        status: "过".repeat(33),
        sender: { id: "user-2", type: "system" },
      }),
    )
    expect(result.current.status).toBeUndefined()
    expect(mocks.recordRealtimeParseFailure).toHaveBeenCalledOnce()
  })

  it("消息创建事件无法解析时记录诊断并保持状态", () => {
    const { result, handlers } = setup()
    emitStatus(handlers)
    mocks.normalizeMessageCreatedEventPayload.mockImplementationOnce(() => {
      throw new Error("invalid payload")
    })

    act(() => handlers.get("message.created")?.({ invalid: true }))

    expect(mocks.recordRealtimeParseFailure).toHaveBeenCalledOnce()
    expect(result.current.status).toBe("正在输入")
  })

  it("忽略非 UUID 会话标识的状态事件", () => {
    const { result, handlers } = setup()
    act(() =>
      handlers.get("conversation.status")?.({
        conversation_id: "conversation-1",
        status: "正在输入",
        sender: { id: "user-2", type: "user" },
      }),
    )
    expect(result.current.status).toBeUndefined()
  })

  it("状态缓存达到上限时淘汰最早的会话", () => {
    const { result, handlers } = setup()
    emitStatus(handlers)

    act(() => {
      for (let index = 1; index <= 100; index += 1) {
        handlers.get("conversation.status")?.({
          conversation_id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          status: "正在输入",
          sender: { id: `user-${index}`, type: "user" },
        })
      }
    })

    expect(result.current.status).toBeUndefined()
  })

  it("断线后清空状态且重连不会恢复旧状态", () => {
    const { handlers, realtime, rerender, result } = setup()
    emitStatus(handlers)
    expect(result.current.status).toBe("正在输入")

    realtime.ready = false
    rerender({ enabled: true, conversationId: conversationOneId })
    expect(result.current.status).toBeUndefined()

    realtime.ready = true
    rerender({ enabled: true, conversationId: conversationOneId })
    expect(result.current.status).toBeUndefined()
  })

  it("输入框聚焦后立即发送并每三秒续期", () => {
    const { result, sendRealtimeRequest } = setup()
    act(() => result.current.onFocus())
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(1)
    expect(sendRealtimeRequest).toHaveBeenLastCalledWith("conversation.status", {
      conversation_id: conversationOneId,
      status: "正在输入",
    })
    act(() => vi.advanceTimersByTime(3_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(2)
  })

  it("切换会话后必须重新聚焦才开始发送", () => {
    const { result, rerender, sendRealtimeRequest } = setup()
    act(() => result.current.onFocus())
    rerender({ enabled: true, conversationId: conversationTwoId })
    const callsAfterSwitch = sendRealtimeRequest.mock.calls.length
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(callsAfterSwitch)

    act(() => result.current.onFocus())
    expect(sendRealtimeRequest).toHaveBeenLastCalledWith(
      "conversation.status",
      expect.objectContaining({ conversation_id: conversationTwoId }),
    )
  })

  it("切换会话后的自动聚焦只为新会话发送并继续续期", () => {
    const handlers = new Map<string, Handler>()
    const sendRealtimeRequest = vi.fn().mockResolvedValue(undefined)
    const realtime: RealtimeContextValue = {
      ready: true,
      status: "connected",
      sendRealtimeRequest,
      subscribeRealtimeEvent: vi.fn((name, handler) => {
        handlers.set(name, handler)
        return () => handlers.delete(name)
      }),
    }
    const view = render(
      <RealtimeContext.Provider value={realtime}>
        <AutoFocusHarness conversationId={conversationOneId} />
      </RealtimeContext.Provider>,
    )
    sendRealtimeRequest.mockClear()

    view.rerender(
      <RealtimeContext.Provider value={realtime}>
        <AutoFocusHarness conversationId={conversationTwoId} />
      </RealtimeContext.Provider>,
    )

    expect(sendRealtimeRequest).toHaveBeenCalledTimes(1)
    expect(sendRealtimeRequest).toHaveBeenLastCalledWith("conversation.status", {
      conversation_id: conversationTwoId,
      status: "正在输入",
    })
    act(() => vi.advanceTimersByTime(3_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(2)
    expect(sendRealtimeRequest).toHaveBeenLastCalledWith("conversation.status", {
      conversation_id: conversationTwoId,
      status: "正在输入",
    })
  })

  it("失焦或窗口隐藏时停止续期", () => {
    const { result, sendRealtimeRequest } = setup()
    act(() => result.current.onFocus())
    act(() => result.current.onBlur())
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(1)

    act(() => result.current.onFocus())
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(2)
    setVisibility("hidden")
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(2)
  })

  it("不支持状态的会话不会发送事件", () => {
    const { result, sendRealtimeRequest } = setup(false)
    act(() => result.current.onFocus())
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).not.toHaveBeenCalled()
  })
})

function AutoFocusHarness({ conversationId }: { conversationId: string }) {
  const { onFocus } = useConversationStatus({ conversationId, supported: true })
  return <FocusOnMount key={conversationId} onFocus={onFocus} />
}

function FocusOnMount({ onFocus }: { onFocus(): void }) {
  React.useEffect(() => {
    onFocus()
  }, [onFocus])
  return null
}
