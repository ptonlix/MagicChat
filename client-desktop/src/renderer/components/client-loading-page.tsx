import { ClientDocumentTitle } from "@/components/client-document-title"
import { useLocale } from "@/components/locale-provider"
import { BrandLoadingScreen } from "@/components/brand-loading-screen"

export function ClientLoadingPage() {
  const { t } = useLocale()
  return (
    <>
      <ClientDocumentTitle title={t("app.title.loading")} disableMessageAlert />
      <BrandLoadingScreen />
    </>
  )
}
