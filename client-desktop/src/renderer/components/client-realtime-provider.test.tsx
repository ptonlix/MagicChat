import { act, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClientRealtimeProvider } from "./client-realtime-provider"
import type { RealtimeClient } from "@/lib/realtime-client"

const mocks = vi.hoisted(() => ({
  clearMessageScope: vi.fn(),
  onUnauthorized: undefined as (() => void) | undefined,
  setAuthenticated: vi.fn(),
}))

vi.mock("@/lib/app-info-context", () => ({
  useAppInfo: () => ({ setAuthenticated: mocks.setAuthenticated }),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({ clearMessageScope: mocks.clearMessageScope }),
}))

vi.mock("@/lib/desktop-host", () => ({
  createDesktopRealtimeClient: (options: { onUnauthorized(): void }) => {
    mocks.onUnauthorized = options.onUnauthorized
    return createRealtimeClientStub()
  },
}))

describe("ClientRealtimeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onUnauthorized = undefined
  })

  it("Realtime 401 先失效消息 scope 再切换登录页", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route
            path="/chat"
            element={
              <ClientRealtimeProvider>
                <div>聊天页</div>
              </ClientRealtimeProvider>
            }
          />
          <Route path="/login" element={<div>登录页</div>} />
        </Routes>
      </MemoryRouter>,
    )

    act(() => mocks.onUnauthorized?.())

    expect(mocks.clearMessageScope).toHaveBeenCalledOnce()
    expect(mocks.clearMessageScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setAuthenticated.mock.invocationCallOrder[0],
    )
    expect(screen.getByText("登录页")).toBeInTheDocument()
  })
})

function createRealtimeClientStub(): RealtimeClient {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getSnapshot: () => ({ ready: true, status: "ready" }),
    sendRequest: vi.fn(),
    subscribe: () => vi.fn(),
    subscribeEvent: () => vi.fn(),
  } as unknown as RealtimeClient
}
