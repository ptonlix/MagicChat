import { ClientDocumentTitle } from "@/components/client-document-title"
import { BrandLoadingScreen } from "@/components/brand-loading-screen"

export function ClientLoadingPage() {
  return (
    <>
      <ClientDocumentTitle title="正在加载" disableMessageAlert />
      <BrandLoadingScreen />
    </>
  )
}
