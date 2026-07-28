import { cn } from "@/lib/utils"

type BrandLoadingScreenProps = {
  className?: string
  detail?: string
  message?: string
}

export function BrandLoadingScreen({
  className,
  detail = "正在为你加载数据",
  message,
}: BrandLoadingScreenProps) {
  return (
    <main
      className={cn(
        "flex h-svh items-center justify-center bg-background text-foreground",
        className,
      )}
    >
      <div className="flex w-56 flex-col items-center gap-3">
        <div className="text-center text-sm text-muted-foreground">
          {message ? `${message} · ${detail}` : detail}
        </div>
        <div
          aria-label="加载进度"
          aria-valuetext="加载中"
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div className="client-loading-progress-indicator h-full w-1/3 rounded-full bg-primary" />
        </div>
      </div>
    </main>
  )
}
