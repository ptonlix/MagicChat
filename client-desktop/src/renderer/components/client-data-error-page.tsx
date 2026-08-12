import { AlertTriangle, CloudOff, RefreshCw, Server, ShieldCheck, Wifi } from "lucide-react"
import type { ReactNode } from "react"

import { useLocale } from "@/components/locale-provider"
import { ClientDocumentTitle } from "@/components/client-document-title"
import { Button } from "@/components/ui/button"

type ClientDataErrorPageProps = {
  message: string
  onRetry: () => void
  workspaceErrorAction?: ReactNode
}

export function ClientDataErrorPage({
  message,
  onRetry,
  workspaceErrorAction,
}: ClientDataErrorPageProps) {
  const { t } = useLocale()
  const connectionChecks = [
    {
      description: t("error.network.desc"),
      icon: Wifi,
      title: t("error.network.title"),
    },
    {
      description: t("error.server.desc"),
      icon: Server,
      title: t("error.server.title"),
    },
    {
      description: t("error.data.desc"),
      icon: ShieldCheck,
      title: t("error.data.title"),
    },
  ]
  return (
    <>
      <ClientDocumentTitle title={t("error.pageTitle")} disableMessageAlert />
      <main className="client-data-error-page min-h-svh bg-background pt-10 text-foreground">
        <header className="client-data-error-header">
          <div className="client-data-error-brand">
            <img alt={t("brand.name")} src="/logo.png" />
            <strong>{t("brand.name")}</strong>
            <span aria-hidden="true" />
            <p>{t("error.workspace")}</p>
          </div>
        </header>

        <div className="client-data-error-layout">
          <section className="client-data-error-content" aria-labelledby="workspace-error-title">
            <div className="client-data-error-icon" aria-hidden="true">
              <CloudOff />
            </div>
            <p className="client-data-error-eyebrow">{t("error.connection")}</p>
            <h1 id="workspace-error-title">{t("error.pageTitle")}</h1>
            <p className="client-data-error-description">{t("error.desc")}</p>

            <div className="client-data-error-detail" role="alert">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>{t("error.failedToConnect")}</strong>
                <p>{message}</p>
              </div>
            </div>

            <div className="client-data-error-actions">
              <Button className="client-data-error-retry" onClick={onRetry} size="lg" type="button">
                <RefreshCw aria-hidden="true" />
                {t("error.reload")}
              </Button>
              <p>{t("error.reloadHint")}</p>
            </div>
            {workspaceErrorAction && (
              <div className="client-data-error-update">{workspaceErrorAction}</div>
            )}
          </section>

          <aside className="client-data-error-checks" aria-label={t("error.checks")}>
            <div className="client-data-error-checks-heading">
              <span aria-hidden="true" />
              <p>{t("error.checks")}</p>
            </div>
            <div className="client-data-error-check-list">
              {connectionChecks.map(({ description, icon: Icon, title }) => (
                <div className="client-data-error-check" key={title}>
                  <Icon aria-hidden="true" />
                  <div>
                    <strong>{title}</strong>
                    <p>{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </main>
    </>
  )
}
