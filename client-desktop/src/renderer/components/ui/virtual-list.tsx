import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { cn } from "@/lib/utils"

const defaultVirtualizationThreshold = 80

export function VirtualList<T>({
  ariaLabel,
  className,
  estimateSize,
  getKey,
  items,
  renderItem,
  role,
  scrollRef,
  threshold = defaultVirtualizationThreshold,
}: {
  ariaLabel?: string
  className?: string
  estimateSize: number
  getKey?: (item: T, index: number) => React.Key
  items: readonly T[]
  renderItem: (item: T, index: number) => React.ReactNode
  role?: React.AriaRole
  scrollRef: React.RefObject<HTMLElement | null>
  threshold?: number
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const virtualized = items.length > threshold
  const [scrollMargin, setScrollMargin] = React.useState(0)
  const virtualizer = useVirtualizer({
    count: virtualized ? items.length : 0,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getKey?.(items[index], index) ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
    scrollMargin,
  })

  React.useLayoutEffect(() => {
    if (!virtualized) return
    const list = listRef.current
    const scrollElement = scrollRef.current
    if (!list || !scrollElement) return

    const measureOffset = () => {
      const listRect = list.getBoundingClientRect()
      const scrollRect = scrollElement.getBoundingClientRect()
      setScrollMargin(listRect.top - scrollRect.top + scrollElement.scrollTop)
      virtualizer.measure()
    }
    measureOffset()
    const observer = new ResizeObserver(measureOffset)
    observer.observe(scrollElement)
    const mutationObserver = new MutationObserver(measureOffset)
    mutationObserver.observe(scrollElement, {
      attributes: true,
      attributeFilter: ["aria-expanded"],
      subtree: true,
    })
    return () => {
      observer.disconnect()
      mutationObserver.disconnect()
    }
  }, [items.length, scrollRef, virtualized, virtualizer])

  if (!virtualized) {
    return (
      <div aria-label={ariaLabel} className={className} role={role}>
        {items.map(renderItem)}
      </div>
    )
  }

  return (
    <div
      aria-label={ariaLabel}
      className={cn("relative w-full", className)}
      ref={listRef}
      role={role}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => (
        <div
          data-index={virtualItem.index}
          key={virtualItem.key}
          ref={virtualizer.measureElement}
          style={{
            left: 0,
            position: "absolute",
            top: 0,
            transform: `translateY(${virtualItem.start - scrollMargin}px)`,
            width: "100%",
          }}
        >
          {renderItem(items[virtualItem.index], virtualItem.index)}
        </div>
      ))}
    </div>
  )
}
