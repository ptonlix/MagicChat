import { ExternalLink, TriangleAlert } from "lucide-react"
import { useLocale } from "@/components/locale-provider"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { parseExternalWebLink } from "@shared/external-link"

export function ExternalLinkConfirmationDialog({
  onConfirm,
  onOpenChange,
  url,
}: {
  onConfirm(url: string): void
  onOpenChange(open: boolean): void
  url?: string
}) {
  const { t } = useLocale()
  const parsedLink = url ? parseExternalWebLink(url) : undefined
  const link = parsedLink?.protocol === "http:" ? parsedLink : undefined

  return (
    <AlertDialog open={Boolean(link)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlert aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("externalLink.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("externalLink.desc")}</AlertDialogDescription>
        </AlertDialogHeader>
        {link && (
          <div className="min-w-0 rounded-md bg-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">
              {t("externalLink.target", { host: link.hostname })}
            </div>
            <div className="mt-1 max-h-24 overflow-auto font-mono text-xs break-all">
              {link.url}
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("externalLink.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => link && onConfirm(link.url)}>
            <ExternalLink aria-hidden="true" />
            {t("externalLink.continue")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
