import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router"

import { AppLayout } from "@/components/app-layout"
import { ClientConversationRealtimeSync } from "@/components/client-conversation-realtime-sync"
import { ClientUserDirectoryRealtimeSync } from "@/components/client-user-directory-realtime-sync"
import { ClientBrandMetadata } from "@/components/client-brand-metadata"
import { ClientDataProvider } from "@/components/client-data-provider"
import { ClientDocumentTitle } from "@/components/client-document-title"
import { ClientMessageNotificationSync } from "@/components/client-message-notification-sync"
import { ClientRealtimeProvider } from "@/components/client-realtime-provider"
import { AppInfoProvider } from "@/components/app-info-provider"
import { useLocale } from "@/components/locale-provider"
import { ChatPage } from "@/pages/chat-page"
import { ContactsPage } from "@/pages/contacts-page"
import { LoginPage } from "@/pages/login-page"
import { ProjectsPage } from "@/pages/projects-page"
import { TaskWorkspacePage } from "@/pages/task-workspace-page"
import {
  documentWindowPath,
  rememberLastNonDocumentRoute,
  type DocumentWindowRouteContext,
} from "@/lib/document-window-route"

const DocumentRoute = lazy(() => import("@/pages/document-route"))

export function App({
  documentWindow,
  updatePrompt,
}: {
  documentWindow?: DocumentWindowRouteContext
  updatePrompt?: ReactNode
}) {
  return (
    <AppInfoProvider>
      <DocumentNavigationMemory disabled={Boolean(documentWindow)} />
      <ClientBrandMetadata />
      {documentWindow ? (
        <DocumentRoutes context={documentWindow} />
      ) : (
        <NormalRoutes updatePrompt={updatePrompt} />
      )}
    </AppInfoProvider>
  )
}

function DocumentNavigationMemory({ disabled }: { disabled: boolean }) {
  const location = useLocation()

  useEffect(() => {
    if (disabled) return
    rememberLastNonDocumentRoute(location)
  }, [disabled, location])

  return null
}

function NormalRoutes({ updatePrompt }: { updatePrompt?: ReactNode }) {
  const { t } = useLocale()
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route
        path="/login"
        element={
          <>
            <ClientDocumentTitle title={t("app.title.login")} disableMessageAlert />
            <LoginPage />
          </>
        }
      />
      <Route element={<AuthenticatedProviderShell workspaceErrorAction={updatePrompt} />}>
        <Route
          path="/tasks/:projectId/:taskId?"
          element={
            <>
              <ClientDocumentTitle title={t("app.title.projects")} />
              <TaskWorkspacePage />
            </>
          }
        />
        <Route element={<AppLayout footerAction={updatePrompt} />}>
          <Route
            path="/init"
            element={
              <>
                <ClientDocumentTitle title={t("app.title.loading")} disableMessageAlert />
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
                <ClientDocumentTitle title={t("app.title.contacts")} />
                <ContactsPage />
              </>
            }
          />
          <Route
            path="/projects/:projectId?/:section?"
            element={
              <>
                <ClientDocumentTitle title={t("app.title.projects")} />
                <ProjectsPage />
              </>
            }
          />
        </Route>
        <Route element={<DocumentProviderShell />}>
          <Route
            path="/documents/document/:documentId"
            element={
              <Suspense fallback={<DocumentRouteLoading />}>
                <DocumentRoute />
              </Suspense>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function DocumentRoutes({ context }: { context: DocumentWindowRouteContext }) {
  return (
    <Routes>
      <Route element={<DocumentProviderShell />}>
        <Route
          path="/documents/document/:documentId"
          element={
            <Suspense fallback={<DocumentRouteLoading />}>
              <DocumentRoute />
            </Suspense>
          }
        />
      </Route>
      <Route
        path="*"
        element={<Navigate to={documentWindowPath(context.documentId, context.serverId)} replace />}
      />
    </Routes>
  )
}

function AuthenticatedProviderShell({
  workspaceErrorAction,
}: {
  workspaceErrorAction?: ReactNode
}) {
  return (
    <ClientDataProvider workspaceErrorAction={workspaceErrorAction}>
      <ClientRealtimeProvider>
        <ClientConversationRealtimeSync />
        <ClientUserDirectoryRealtimeSync />
        <ClientMessageNotificationSync />
        <Outlet />
      </ClientRealtimeProvider>
    </ClientDataProvider>
  )
}

function DocumentProviderShell() {
  return <Outlet />
}

function DocumentRouteLoading() {
  const { t } = useLocale()
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      {t("app.title.document")}
    </main>
  )
}

export default App

function InitPage() {
  return <Navigate to="/chat" replace />
}
