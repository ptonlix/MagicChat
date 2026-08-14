import { cn } from "@/lib/utils"
import { useLocale } from "@/components/locale-provider"
import { Flower2, Sparkles } from "lucide-react"

type BrandLoadingScreenProps = {
  className?: string
  detail?: string
  message?: string
}

export function BrandLoadingScreen({ className, detail, message }: BrandLoadingScreenProps) {
  const { t } = useLocale()
  const detailText = detail ?? t("brandLoading.detail")
  return (
    <main className={cn("brand-loading-screen text-foreground", className)}>
      <div className="brand-loading-content">
        <div className="brand-loading-mark-wrap">
          <span aria-hidden="true" className="brand-loading-ring" />
          <div
            aria-label={t("brandLoading.moli")}
            className="brand-loading-mark brand-loading-moli"
            role="img"
          >
            <Flower2 aria-hidden="true" />
            <Sparkles aria-hidden="true" className="brand-loading-moli-sparkle" />
          </div>
        </div>
        <div className="brand-loading-copy">
          {message && <strong>{message}</strong>}
          <span>{detailText}</span>
        </div>
        <div aria-hidden="true" className="brand-loading-dots">
          <i />
          <i />
          <i />
        </div>
        <div
          aria-label={t("brandLoading.progress")}
          aria-valuetext={t("brandLoading.loading")}
          className="brand-loading-progress"
          role="progressbar"
        >
          <div className="client-loading-progress-indicator" />
        </div>
      </div>
    </main>
  )
}
