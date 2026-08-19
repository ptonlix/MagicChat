import { cn } from "@/lib/utils"

export function ConversationStatusIndicator({
  announce = false,
  className,
  status,
}: {
  announce?: boolean
  className?: string
  status: string
}) {
  return (
    <span
      aria-live={announce ? "polite" : undefined}
      className={cn("inline-flex max-w-full min-w-0 items-center gap-1.5", className)}
      role={announce ? "status" : undefined}
    >
      <span className="overflow-wrap-anywhere min-w-0">{status}</span>
      <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-0.5">
        {[-0.3, -0.15, 0].map((delay) => (
          <span
            className="size-1 animate-bounce rounded-full bg-current motion-reduce:animate-none"
            data-status-dot
            key={delay}
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
    </span>
  )
}
