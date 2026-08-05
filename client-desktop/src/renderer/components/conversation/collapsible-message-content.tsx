import * as React from "react"
import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const heights = { markdown: 360, text: 273 } as const
const mask: React.CSSProperties = {
  maskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)",
  WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)",
}

export function CollapsibleMessageContent({
  children,
  enabled = true,
  onSizeChange,
  variant,
}: {
  children: React.ReactNode
  enabled?: boolean
  onSizeChange?: () => void
  variant: keyof typeof heights
}) {
  const id = React.useId()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [canExpand, setCanExpand] = React.useState(false)
  const maximum = heights[variant]

  React.useLayoutEffect(() => {
    if (!enabled) return
    const content = contentRef.current
    if (!content) return
    const measure = () => {
      const next = content.scrollHeight > maximum + 1
      setCanExpand(next)
      if (!next) setExpanded(false)
      onSizeChange?.()
    }
    measure()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [enabled, maximum, onSizeChange])

  if (!enabled) return children
  const collapsed = canExpand && !expanded
  return (
    <div
      className={cn("relative max-w-full min-w-0", collapsed && "pb-7")}
      data-slot="collapsible-message"
    >
      <div
        className={cn("relative min-w-0", !expanded && "overflow-hidden")}
        id={id}
        style={{
          ...(!expanded ? { maxHeight: maximum } : undefined),
          ...(collapsed ? mask : undefined),
        }}
      >
        <div className="min-w-0" ref={contentRef}>
          {children}
        </div>
      </div>
      {canExpand && (
        <Button
          aria-controls={id}
          aria-expanded={expanded}
          className={cn(
            "w-full px-2 text-xs text-muted-foreground hover:bg-transparent dark:hover:bg-transparent",
            collapsed
              ? "absolute inset-x-0 bottom-0 h-[calc(3rem+1.75rem)] items-end pb-1"
              : "mt-1 h-7 items-center",
          )}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setExpanded((current) => !current)
            onSizeChange?.()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="flex h-6 items-center justify-center gap-1">
            <ChevronDown className={cn("size-3.5", expanded && "rotate-180")} />
            {expanded ? "收起全文" : "展开全文"}
          </span>
        </Button>
      )}
    </div>
  )
}
