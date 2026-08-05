import { lazy, Suspense, type ReactNode } from "react"
import { Navigate, Outlet, Route, Routes } from "react-router"

import { AppLayout } from "@/components/app-layout"
import { ClientConversationRealtimeSync } from "@/components/client-conversation-realtime-sync"
import { ClientBrandMetadata } from "@/components/client-brand-metadata"
import { ClientDataProvider } from "@/components/client-data-provider"
import { ClientDocumentTitle } from "@/components/client-document-title"
import { ClientMessageNotificationSync } from "@/components/client-message-notification-sync"
import { ClientRealtimeProvider } from "@/components/client-realtime-provider"
import { AppInfoProvider } from "@/components/app-info-provider"
import { ChatPage } from "@/pages/chat-page"
import { ContactsPage } from "@/pages/contacts-page"
import { LoginPage } from "@/pages/login-page"
import { ProjectsPage } from "@/pages/projects-page"

const DocumentPage = lazy(() => import("@/pages/document-page"))

export function App({ updatePrompt }: { updatePrompt?: ReactNode }) {
  return (
    <AppInfoProvider>
      <ClientBrandMetadata />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route
          path="/login"
          element={
            <>
              <ClientDocumentTitle title="登录" disableMessageAlert />
              <LoginPage />
            </>
          }
        />
        <Route element={<AuthenticatedProviderShell />}>
          <Route element={<AppLayout footerAction={updatePrompt} />}>
            <Route
              path="/init"
              element={
                <>
                  <ClientDocumentTitle title="正在加载" disableMessageAlert />
                  <InitPage />
                </>
              }
            />
            <Route
              path="/chat/:conversationId?"
              element={
                <>
                  <ClientDocumentTitle />
                  <ChatPage />
                </>
              }
            />
            <Route
              path="/contacts/:directoryType?/:directoryId?"
              element={
                <>
                  <ClientDocumentTitle title="联系人" />
                  <ContactsPage />
                </>
              }
            />
            <Route
              path="/projects/:projectId?/:section?"
              element={
                <>
                  <ClientDocumentTitle title="项目" />
                  <ProjectsPage />
                </>
              }
            />
          </Route>
          <Route
            path="/documents/document/:documentId"
            element={
              <Suspense fallback={<DocumentRouteLoading />}>
                <DocumentPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AppInfoProvider>
  )
}

function AuthenticatedProviderShell() {
  return (
    <ClientDataProvider>
      <ClientRealtimeProvider>
        <ClientConversationRealtimeSync />
        <ClientMessageNotificationSync />
        <Outlet />
      </ClientRealtimeProvider>
    </ClientDataProvider>
  )
}

function DocumentRouteLoading() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      正在加载文档工作区
    </main>
  )
}

export default App

function InitPage() {
  return <Navigate to="/chat" replace />
}
