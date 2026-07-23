import * as React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { VirtualList } from "@/components/ui/virtual-list"

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () => count > 0
      ? [
          { index: 10, key: "item-10", start: 400 },
          { index: 11, key: "item-11", start: 440 },
        ]
      : [],
    measure: vi.fn(),
    measureElement: vi.fn(),
  }),
}))

describe("VirtualList", () => {
  it("小列表完整渲染", () => {
    render(<ListFixture count={3} />)
    expect(screen.getAllByRole("option")).toHaveLength(3)
  })

  it("长列表只渲染可见窗口", () => {
    render(<ListFixture count={100} />)
    expect(screen.getAllByRole("option")).toHaveLength(2)
    expect(screen.getByText("项目 10")).toBeInTheDocument()
    expect(screen.getByText("项目 11")).toBeInTheDocument()
    expect(screen.queryByText("项目 12")).not.toBeInTheDocument()
  })
})

function ListFixture({ count }: { count: number }) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const items = Array.from({ length: count }, (_, index) => index)
  return (
    <div ref={scrollRef}>
      <VirtualList
        estimateSize={40}
        items={items}
        renderItem={(item) => <div role="option">项目 {item}</div>}
        role="listbox"
        scrollRef={scrollRef}
      />
    </div>
  )
}
