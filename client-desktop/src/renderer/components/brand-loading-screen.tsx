import { cn } from "@/lib/utils"

type BrandLoadingScreenProps = {
  className?: string
  detail?: string
  message?: string
}

export function BrandLoadingScreen({
  className,
  detail = "正在同步你的工作空间",
  message = "正在进入即应",
}: BrandLoadingScreenProps) {
  return (
    <main className={cn("brand-loading-screen", className)}>
      <div aria-hidden="true" className="brand-loading-orb brand-loading-orb-one" />
      <div aria-hidden="true" className="brand-loading-orb brand-loading-orb-two" />
      <div className="brand-loading-content">
        <div className="brand-loading-mark-wrap">
          <div aria-hidden="true" className="brand-loading-ring" />
          <img alt="即应" className="brand-loading-mark" src="/logo.png" />
        </div>
        <div className="brand-loading-copy">
          <strong>{message}</strong>
          <span>{detail}</span>
        </div>
        <div aria-label="加载中" className="brand-loading-dots" role="status">
          <i />
          <i />
          <i />
        </div>
      </div>
    </main>
  )
}
