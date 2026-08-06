import { DocumentDataProvider } from "@/components/document-data-provider"
import DocumentPage from "@/pages/document-page"

export default function DocumentRoute() {
  return (
    <DocumentDataProvider>
      <DocumentPage />
    </DocumentDataProvider>
  )
}
