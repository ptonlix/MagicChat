import { cn } from "@/lib/utils"
import { useLocale } from "@/components/locale-provider"

type BrandLoadingScreenProps = {
  className?: string
  detail?: string
  message?: string
}

export function BrandLoadingScreen({ className, detail, message }: BrandLoadingScreenProps) {
  const { t } = useLocale()
  const detailText = detail ?? t("brandLoading.detail")
  return (
    <main
      className={cn(
        "flex h-svh items-center justify-center bg-background text-foreground",
        className,
      )}
    >
      <div className="flex w-56 flex-col items-center gap-3">
        <div className="text-center text-sm text-muted-foreground">
          {message ? `${message} · ${detailText}` : detailText}
        </div>
        <div
          aria-label={t("brandLoading.progress")}
          aria-valuetext={t("brandLoading.loading")}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div className="client-loading-progress-indicator h-full w-1/3 rounded-full bg-primary" />
        </div>
      </div>
    </main>
  )
}
