import { useLocale } from "@/components/locale-provider"

export function ProjectGoalsTab() {
  const { t } = useLocale()
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-muted text-sm text-muted-foreground">
      {t("project.goals.pending")}
    </div>
  )
}
