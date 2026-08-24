import * as React from "react"
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider"
import {
  AppWindow,
  Ellipsis,
  FileText,
  Loader2,
  Menu,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from "lucide-react"
import { Link, useBlocker, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import * as Y from "yjs"

import { ClientDocumentTitle } from "@/components/client-document-title"
import { SendCardDialog, StandaloneCardDialog } from "@/components/conversation/send-card-dialog"
import { DocumentEditor } from "@/components/documents/document-editor"
const MarkdownDocumentEditor = React.lazy(() =>
  import("@/components/documents/markdown-document-editor").then((module) => ({
    default: module.MarkdownDocumentEditor,
  })),
)
import { DocumentWorkspaceSidebar } from "@/components/documents/document-workspace-sidebar"
import { useLocale } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import {
  deleteClientDocument,
  getClientDocument,
  updateCollaborativeDocumentTitle,
  type ClientDocument,
  type ClientDocumentType,
} from "@/lib/document-data-api"
import {
  createDocumentWebSocketPolyfill,
  DocumentCollaborationProviderWebsocket,
} from "@/lib/document-collaboration-socket"
import { DocumentBodySyncController, type DocumentBodySyncSnapshot } from "@/lib/document-body-sync"
import { createDocumentCard } from "@/lib/document-card"
import { useDesktopTarget } from "@/hooks/use-desktop-target"
import {
  DocumentTitleController,
  limitDocumentTitle,
  normalizeDocumentTitle,
  type DocumentTitleSnapshot,
} from "@/lib/document-title-controller"
import { getClientProject, type ClientProjectDetail } from "@/lib/project-data-api"
import { displayDirectoryUser } from "@/lib/project-user-hydration"
import { useDocumentData } from "@/lib/document-data-context"
import {
  documentWindowFeedbackKey,
  getDocumentReturnPath,
  parseDocumentWindowLocation,
  DocumentWindowOpenError,
  requestDocumentWindow,
} from "@/lib/document-window-route"
import {
  documentPresenceColor,
  normalizeDocumentPresenceUsers,
  type DocumentPresenceUser,
} from "@/lib/document-presence"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { TranslationKey } from "@/lib/i18n"

type Loaded = Readonly<{
  document: EditableClientDocument
  project: ClientProjectDetail
}>
type EditableClientDocument = Readonly<
  Omit<ClientDocument, "documentType" | "kind"> & {
    documentType: ClientDocumentType
    kind: "document"
  }
>
type DocumentUnavailableMessage = Readonly<{ key: TranslationKey }> | Readonly<{ value: string }>
type DocumentLoadError = Readonly<{
  documentId: string
  message: DocumentUnavailableMessage
}>
type DocumentNavigationHandlers = Readonly<{
  allowConfirmedNavigation(): void
  beforeNavigate(confirmedVersion?: number): boolean
  getEditVersion(): number
}>

function isEditableClientDocument(document: ClientDocument): document is EditableClientDocument {
  return (
    document.kind === "document" &&
    (document.documentType === "document" || document.documentType === "markdown")
  )
}

export function DocumentPage() {
  const { documentId = "" } = useParams<{ documentId: string }>()
  const [loaded, setLoaded] = React.useState<Loaded>()
  const [error, setError] = React.useState<DocumentLoadError>()
  const [loading, setLoading] = React.useState(true)
  const [retry, setRetry] = React.useState(0)

  React.useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    setLoading(true)
    if (!documentId) {
      setError({ documentId, message: { key: "document.invalidId" } })
      setLoading(false)
      return () => controller.abort()
    }
    void getClientDocument(documentId, fetch, controller.signal)
      .then(async (document) => {
        if (!isEditableClientDocument(document)) {
          if (!controller.signal.aborted) {
            setError({ documentId, message: { key: "document.notEditable" } })
            setLoading(false)
          }
          return
        }
        const project = await getClientProject(document.projectId)
        if (!controller.signal.aborted) {
          setLoaded({ document, project })
          setLoading(false)
        }
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError({
            documentId,
            message:
              loadError instanceof Error
                ? { value: loadError.message }
                : { key: "document.loadFailed" },
          })
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [documentId, retry])

  const currentError = error?.documentId === documentId ? error.message : undefined
  if (!loaded && currentError)
    return (
      <DocumentUnavailable message={currentError} onRetry={() => setRetry((value) => value + 1)} />
    )
  if (!loaded) return <DocumentLoading />
  return (
    <DocumentWorkspace
      contentError={currentError}
      document={loaded.document}
      key={loaded.project.id}
      loading={loading || loaded.document.id !== documentId}
      onRetry={() => setRetry((value) => value + 1)}
      project={loaded.project}
    />
  )
}

function DocumentWorkspace({
  contentError,
  document,
  loading,
  onRetry,
  project,
}: {
  contentError?: DocumentUnavailableMessage
  document: EditableClientDocument
  loading: boolean
  onRetry(): void
  project: ClientProjectDetail
}) {
  const { t } = useLocale()
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [sidebarTitle, setSidebarTitle] = React.useState(() => ({
    documentId: document.id,
    title: normalizeDocumentTitle(document.title),
  }))
  const navigationHandlersRef = React.useRef<
    { documentId: string; handlers: DocumentNavigationHandlers } | undefined
  >(undefined)
  const activeTitle =
    sidebarTitle.documentId === document.id
      ? sidebarTitle.title
      : normalizeDocumentTitle(document.title)
  const getEditVersion = React.useCallback(
    () => navigationHandlersRef.current?.handlers.getEditVersion() ?? 0,
    [],
  )
  const allowConfirmedNavigation = React.useCallback(() => {
    navigationHandlersRef.current?.handlers.allowConfirmedNavigation()
  }, [])
  const beforeNavigate = React.useCallback(
    (confirmedVersion?: number) =>
      navigationHandlersRef.current?.handlers.beforeNavigate(confirmedVersion) ?? true,
    [],
  )
  const handleNavigationHandlersChange = React.useCallback(
    (documentId: string, handlers: DocumentNavigationHandlers | null) => {
      if (handlers) {
        navigationHandlersRef.current = { documentId, handlers }
      } else if (navigationHandlersRef.current?.documentId === documentId) {
        navigationHandlersRef.current = undefined
      }
    },
    [],
  )
  const handleSidebarTitleChange = React.useCallback((documentId: string, title: string) => {
    setSidebarTitle((current) =>
      current.documentId === documentId && current.title === title
        ? current
        : { documentId, title },
    )
  }, [])
  const sidebar = (
    <DocumentWorkspaceSidebar
      activeDocumentId={document.id}
      activeTitle={activeTitle}
      getEditVersion={getEditVersion}
      onAllowConfirmedNavigation={allowConfirmedNavigation}
      onBeforeNavigate={beforeNavigate}
      projectAvatar={project.avatar}
      projectId={project.id}
      projectIsPersonal={project.isPersonal}
      projectName={project.name}
    />
  )

  return (
    <main className="flex h-svh min-h-0 min-w-0 overflow-hidden bg-muted/40 pt-10">
      <aside className="hidden w-72 shrink-0 border-r md:block">{sidebar}</aside>
      <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
        <SheetContent className="w-72 px-0 pt-10 pb-0" side="left">
          <SheetTitle className="sr-only">{t("document.navTitle")}</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      {contentError ? (
        <DocumentContentUnavailable message={contentError} onRetry={onRetry} />
      ) : loading ? (
        <DocumentContentLoading />
      ) : (
        <DocumentSession
          document={document}
          key={document.id}
          onNavigationHandlersChange={handleNavigationHandlersChange}
          onOpenSidebar={() => setSheetOpen(true)}
          onSidebarTitleChange={handleSidebarTitleChange}
          project={project}
        />
      )}
    </main>
  )
}

function DocumentSession({
  document,
  onNavigationHandlersChange,
  onOpenSidebar,
  onSidebarTitleChange,
  project,
}: {
  document: EditableClientDocument
  onNavigationHandlersChange(documentId: string, handlers: DocumentNavigationHandlers | null): void
  onOpenSidebar(): void
  onSidebarTitleChange(documentId: string, title: string): void
  project: ClientProjectDetail
}) {
  const { t } = useLocale()
  const target = useDesktopTarget()
  const navigate = useNavigate()
  const { me, refreshMe, refreshProjects } = useDocumentData()
  const collaborationAvatar = me?.avatar ?? document.updatedBy.avatar
  const collaborationId = me?.id ?? document.updatedBy.id
  const collaborationName =
    me?.nickname.trim() ||
    me?.name.trim() ||
    displayDirectoryUser(document.updatedBy) ||
    t("document.currentUser")
  const collaborationUser = React.useMemo(() => {
    return {
      avatar: collaborationAvatar,
      color: documentPresenceColor(collaborationId),
      id: collaborationId,
      name: collaborationName,
    }
  }, [collaborationAvatar, collaborationId, collaborationName])
  const [ydoc] = React.useState(() => new Y.Doc())
  const ydocDestroyTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const titleControllerDestroyTimers = React.useRef(
    new Map<DocumentTitleController, ReturnType<typeof setTimeout>>(),
  )
  const [bodyController] = React.useState(() => new DocumentBodySyncController())
  const [body, setBody] = React.useState<DocumentBodySyncSnapshot>(bodyController.value)
  const [permissionDenied, setPermissionDenied] = React.useState(false)
  const [collaborationProvider, setCollaborationProvider] = React.useState<HocuspocusProvider>()
  const [onlineUsers, setOnlineUsers] = React.useState<DocumentPresenceUser[]>([])
  const [openingWindow, setOpeningWindow] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const isDocumentWindow = parseDocumentWindowLocation().kind === "document"
  const collaborationUserRef = React.useRef(collaborationUser)
  const collaborationProviderRef = React.useRef<HocuspocusProvider | undefined>(undefined)
  const publishedCollaborationUserRef = React.useRef<DocumentPresenceUser | undefined>(undefined)
  const refreshAccountDataRef = React.useRef({ refreshMe, refreshProjects })
  const publishCollaborationUser = React.useCallback(
    (provider: HocuspocusProvider, user: DocumentPresenceUser) => {
      if (publishedCollaborationUserRef.current === user) return
      provider.setAwarenessField("user", user)
      publishedCollaborationUserRef.current = user
    },
    [],
  )
  const titleController = React.useMemo(
    () =>
      new DocumentTitleController(document.title, (title) =>
        updateCollaborativeDocumentTitle(document.id, title),
      ),
    [document.id, document.title],
  )
  const [title, setTitle] = React.useState<DocumentTitleSnapshot>(titleController.value)
  const titleText = normalizeDocumentTitle(title.input)
  const documentCard = React.useMemo(
    () => createDocumentCard(document.id, titleText, project.name, document.documentType),
    [document.documentType, document.id, project.name, titleText],
  )
  const dirty = titleController.dirty || body.unsyncedChanges > 0
  const allowNextNavigation = React.useRef(false)
  const allowWindowClose = React.useRef(false)
  const bodyUnsyncedChanges = React.useRef(0)
  const editVersion = React.useRef(0)
  const blocker = useBlocker(() => {
    if (allowNextNavigation.current) {
      allowNextNavigation.current = false
      return false
    }
    return dirty
  })

  React.useEffect(() => titleController.subscribe(setTitle), [titleController])
  React.useEffect(() => {
    const destroyTimers = titleControllerDestroyTimers.current
    const pendingDestroy = destroyTimers.get(titleController)
    if (pendingDestroy) {
      clearTimeout(pendingDestroy)
      destroyTimers.delete(titleController)
    }
    return () => {
      const timer = setTimeout(() => {
        destroyTimers.delete(titleController)
        titleController.destroy()
      }, 0)
      destroyTimers.set(titleController, timer)
    }
  }, [titleController])
  React.useEffect(() => {
    refreshAccountDataRef.current = { refreshMe, refreshProjects }
  }, [refreshMe, refreshProjects])
  React.useEffect(() => {
    collaborationUserRef.current = collaborationUser
  }, [collaborationUser])
  React.useEffect(() => {
    if (ydocDestroyTimer.current) clearTimeout(ydocDestroyTimer.current)
    return () => {
      // 延迟到下一任务，避免 React StrictMode 的 Effect 重放提前销毁仍将复用的 Y.Doc。
      ydocDestroyTimer.current = setTimeout(() => ydoc.destroy(), 0)
    }
  }, [ydoc])

  React.useEffect(() => {
    let active = true
    let permissionRefreshStarted = false
    let collaborationStopped = false
    const collaboration: {
      provider?: HocuspocusProvider
      websocketProvider?: DocumentCollaborationProviderWebsocket
    } = {}
    const stopCollaboration = () => {
      if (collaborationStopped) return
      collaborationStopped = true
      collaboration.provider?.destroy()
      collaboration.websocketProvider?.destroy()
    }
    const handlePermissionDenied = () => {
      if (!active || permissionRefreshStarted) return
      permissionRefreshStarted = true
      stopCollaboration()
      setPermissionDenied(true)
      setBody(bodyController.failed())
      const refreshAccountData = refreshAccountDataRef.current
      void Promise.allSettled([
        refreshAccountData.refreshProjects(),
        refreshAccountData.refreshMe(),
      ])
    }
    const websocketProvider = new DocumentCollaborationProviderWebsocket({
      WebSocketPolyfill: createDocumentWebSocketPolyfill(target, document.id),
      url: "desktop://document-collaboration",
    })
    collaboration.websocketProvider = websocketProvider
    const provider = new HocuspocusProvider({
      document: ydoc,
      name: document.id,
      onAwarenessChange: ({ states }) => {
        if (active) setOnlineUsers(normalizeDocumentPresenceUsers(states, collaborationId))
      },
      onAuthenticationFailed: handlePermissionDenied,
      onClose: ({ event }) => {
        if (event.code === 4403) handlePermissionDenied()
      },
      onStatus: ({ status }) => {
        if (!active) return
        if (status === WebSocketStatus.Connecting) {
          setBody(bodyController.connecting())
        } else if (status === WebSocketStatus.Disconnected) {
          setBody(bodyController.disconnected())
        }
      },
      onSynced: ({ state }) => {
        if (active && state) {
          setBody(bodyController.synchronized())
        }
      },
      onUnsyncedChanges: ({ number }) => {
        if (active) {
          if (number > bodyUnsyncedChanges.current) editVersion.current += 1
          bodyUnsyncedChanges.current = number
          setBody(bodyController.setUnsyncedChanges(number))
        }
      },
      token: "desktop-session",
      websocketProvider,
    })
    collaboration.provider = provider
    collaborationProviderRef.current = provider
    publishedCollaborationUserRef.current = undefined
    publishCollaborationUser(provider, collaborationUserRef.current)
    setCollaborationProvider(provider)
    // 注入共享 WebSocket 后 Provider 不会自动绑定事件，必须显式 attach 才会开始认证和同步。
    provider.attach()
    const sharedTitle = ydoc.getText("title")
    const observeTitle = () => {
      const remote = sharedTitle.toString()
      if (remote) titleController.receiveRemote(remote)
    }
    sharedTitle.observe(observeTitle)
    return () => {
      active = false
      if (collaborationProviderRef.current === provider) {
        collaborationProviderRef.current = undefined
        publishedCollaborationUserRef.current = undefined
      }
      setCollaborationProvider((current) => (current === provider ? undefined : current))
      setOnlineUsers([])
      sharedTitle.unobserve(observeTitle)
      stopCollaboration()
    }
  }, [
    bodyController,
    collaborationId,
    document.id,
    publishCollaborationUser,
    target,
    titleController,
    ydoc,
  ])

  React.useEffect(() => {
    const provider = collaborationProviderRef.current
    if (provider) publishCollaborationUser(provider, collaborationUser)
  }, [collaborationUser, publishCollaborationUser])

  React.useEffect(() => {
    if (blocker.state !== "blocked") return
    if (window.confirm(t("document.unsavedLeave"))) blocker.proceed()
    else blocker.reset()
  }, [blocker, t])

  React.useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowWindowClose.current) return
      if (titleController.dirty || body.unsyncedChanges > 0) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [body.unsyncedChanges, titleController])

  const confirmLeave = React.useCallback(
    (confirmedVersion?: number) =>
      confirmedVersion === editVersion.current ||
      !(titleController.dirty || bodyUnsyncedChanges.current > 0) ||
      window.confirm(t("document.unsavedLeave")),
    [t, titleController],
  )
  const getEditVersion = React.useCallback(() => editVersion.current, [])
  const allowConfirmedNavigation = React.useCallback(() => {
    allowNextNavigation.current = true
  }, [])
  React.useLayoutEffect(() => {
    onNavigationHandlersChange(document.id, {
      allowConfirmedNavigation,
      beforeNavigate: confirmLeave,
      getEditVersion,
    })
    return () => onNavigationHandlersChange(document.id, null)
  }, [
    allowConfirmedNavigation,
    confirmLeave,
    document.id,
    getEditVersion,
    onNavigationHandlersChange,
  ])
  React.useEffect(() => {
    onSidebarTitleChange(document.id, titleText)
  }, [document.id, onSidebarTitleChange, titleText])
  const saveTitle = () =>
    void titleController.flush().catch(() => toast.error(t("document.titleSaveFailed")))
  const openInWindow = async () => {
    if (openingWindow) return
    const returnPath = isDocumentWindow
      ? undefined
      : getDocumentReturnPath(`/projects/${encodeURIComponent(project.id)}/documents`)
    setOpeningWindow(true)
    try {
      const result = await requestDocumentWindow(document.id, target.id, document.documentType)
      toast.success(
        t(result.status === "focused" ? "documentWindow.focused" : "documentWindow.opened"),
      )
      if (returnPath) {
        if (typeof globalThis.document.startViewTransition === "function") {
          navigate(returnPath, { replace: true, viewTransition: true })
        } else {
          navigate(returnPath, { replace: true })
        }
      }
    } catch (reason) {
      const code = reason instanceof DocumentWindowOpenError ? reason.code : "bridge_unavailable"
      toast.error(t(documentWindowFeedbackKey(code)))
    } finally {
      setOpeningWindow(false)
    }
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await deleteClientDocument(document.id)
      toast.success(t("document.deleteSuccess"))
      setDeleteOpen(false)
      if (isDocumentWindow) {
        allowWindowClose.current = true
        window.close()
      } else {
        allowNextNavigation.current = true
        navigate(`/projects/${encodeURIComponent(project.id)}/documents`, {
          replace: true,
        })
      }
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : t("document.deleteFailed"))
    } finally {
      setDeleting(false)
    }
  }

  if (permissionDenied)
    return (
      <DocumentContentUnavailable
        message={{ key: "document.noAccess" }}
        projectId={document.projectId}
      />
    )

  return (
    <>
      <ClientDocumentTitle disableMessageAlert title={titleText} />
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background/40">
        <header className="no-drag flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3 sm:px-5">
          <Button
            aria-label={t("document.nav")}
            className="md:hidden"
            onClick={onOpenSidebar}
            size="icon-sm"
            variant="ghost"
          >
            <Menu />
          </Button>
          <FileText className="size-5 shrink-0 text-sky-600" />
          <input
            aria-label={t("document.titleBar")}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none"
            onBlur={saveTitle}
            onChange={(event) => {
              editVersion.current += 1
              titleController.change(limitDocumentTitle(event.target.value))
            }}
            placeholder={t("document.untitled")}
            value={title.input}
          />
          <span
            aria-live="polite"
            className="hidden shrink-0 text-xs text-muted-foreground lg:inline"
          >
            {title.state === "failed"
              ? t("document.titleSaveFailed")
              : title.state === "saving"
                ? t("document.titleSaving")
                : title.state === "pending"
                  ? t("document.titlePending")
                  : t("document.titleSaved")}{" "}
            ·{" "}
            {body.state === "connecting"
              ? t("document.bodyConnecting")
              : body.state === "saving"
                ? t("document.bodySyncing")
                : body.state === "failed"
                  ? t("document.bodySyncFailed")
                  : t("document.bodySynced")}
          </span>
          {title.state === "failed" && (
            <Button
              aria-label={t("document.retrySaveTitle")}
              onClick={saveTitle}
              size="icon-sm"
              variant="ghost"
            >
              <RefreshCw />
            </Button>
          )}
          <Button
            aria-label={
              isDocumentWindow ? t("document.openInWindow") : t("document.openInWindowAndReturn")
            }
            disabled={openingWindow}
            onClick={() => void openInWindow()}
            size="icon-sm"
            title={
              isDocumentWindow ? t("document.openInWindow") : t("document.openInWindowAndReturn")
            }
            variant="ghost"
          >
            {openingWindow ? <Loader2 className="animate-spin" /> : <AppWindow />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("document.moreActions")}
                disabled={deleting}
                size="icon-sm"
                title={t("document.moreActions")}
                variant="ghost"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                disabled={deleting}
                onSelect={() => requestAnimationFrame(() => setSendDialogOpen(true))}
              >
                <Send />
                {t("document.sendToConversation")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={deleting}
                onSelect={() => setDeleteOpen(true)}
                variant="destructive"
              >
                <Trash2 />
                {t("document.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isDocumentWindow ? (
            <StandaloneCardDialog
              card={documentCard}
              onOpenChange={setSendDialogOpen}
              open={sendDialogOpen}
            />
          ) : (
            <SendCardDialog
              card={documentCard}
              onOpenChange={setSendDialogOpen}
              open={sendDialogOpen}
            />
          )}
          <AlertDialog
            onOpenChange={(open) => {
              if (!deleting) setDeleteOpen(open)
            }}
            open={deleteOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("document.deleteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("document.deleteDescription", { title: titleText })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>{t("document.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={(event) => {
                    event.preventDefault()
                    void handleDelete()
                  }}
                  variant="destructive"
                >
                  {deleting && <Loader2 className="animate-spin" />}
                  {t("document.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <DocumentOnlineUsers users={onlineUsers} />
        </header>
        {collaborationProvider ? (
          <React.Suspense
            fallback={
              <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
                正在加载文档编辑器
              </div>
            }
          >
            {document.documentType === "markdown" ? (
              <MarkdownDocumentEditor
                collaborationDocument={ydoc}
                collaborationProvider={collaborationProvider}
                onTitleBlur={saveTitle}
                onTitleChange={(value) => {
                  editVersion.current += 1
                  titleController.change(value)
                }}
                title={title.input}
              />
            ) : (
              <DocumentEditor
                collaborationDocument={ydoc}
                collaborationProvider={collaborationProvider}
                collaborationUser={collaborationUser}
                onTitleBlur={saveTitle}
                onTitleChange={(value) => {
                  editVersion.current += 1
                  titleController.change(value)
                }}
                title={title.input}
              />
            )}
          </React.Suspense>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("document.collaborationConnecting")}
          </div>
        )}
      </section>
    </>
  )
}

function DocumentOnlineUsers({ users }: { users: readonly DocumentPresenceUser[] }) {
  const { t } = useLocale()
  if (users.length === 0) return null
  const visible = users.slice(0, 5)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={t("document.onlineMembers", { count: users.length })}
          className="shrink-0"
          size="sm"
          variant="ghost"
        >
          <div className="flex -space-x-2">
            {visible.map((user) => (
              <PresenceAvatar key={user.id} user={user} />
            ))}
          </div>
          {users.length > visible.length && <span>+{users.length - visible.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(24rem,calc(100vh-2rem))] w-72 overflow-y-auto"
      >
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Users className="size-4" />
          {t("document.onlineMembersTitle", { count: users.length })}
        </div>
        <div className="grid gap-1">
          {users.map((user) => (
            <div className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1.5" key={user.id}>
              <PresenceAvatar user={user} />
              <span className="overflow-wrap-anywhere min-w-0 text-sm">{user.name}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PresenceAvatar({ user }: { user: DocumentPresenceUser }) {
  return (
    <Avatar
      aria-label={user.name}
      className="size-7 border-2 border-background"
      role="img"
      style={{ outline: `2px solid ${user.color}`, outlineOffset: "-1px" }}
    >
      {user.avatar && <AvatarImage alt={user.name} src={user.avatar} />}
      <AvatarFallback>{Array.from(user.name)[0] ?? "?"}</AvatarFallback>
    </Avatar>
  )
}

function DocumentContentLoading() {
  const { t } = useLocale()
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center gap-2 bg-background/40 text-sm text-muted-foreground">
      <ClientDocumentTitle disableMessageAlert title={t("document.loading")} />
      <Loader2 className="size-4 animate-spin" />
      {t("document.loading")}
    </section>
  )
}

function DocumentContentUnavailable({
  message,
  onRetry,
  projectId,
}: {
  message: DocumentUnavailableMessage
  onRetry?: () => void
  projectId?: string
}) {
  const { t } = useLocale()
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-background/40 px-6 pb-6">
      <ClientDocumentTitle disableMessageAlert title={t("document.cannotOpen")} />
      <DocumentUnavailableCard message={message} onRetry={onRetry} projectId={projectId} />
    </section>
  )
}

function DocumentLoading() {
  const { t } = useLocale()
  return (
    <main className="flex h-svh min-h-0 items-center justify-center gap-2 pt-10 text-sm text-muted-foreground">
      <ClientDocumentTitle disableMessageAlert title={t("document.loading")} />
      <Loader2 className="size-4 animate-spin" />
      {t("document.loading")}
    </main>
  )
}

function DocumentUnavailable({
  message,
  onRetry,
  projectId,
}: {
  message: DocumentUnavailableMessage
  onRetry?: () => void
  projectId?: string
}) {
  const { t } = useLocale()
  return (
    <main className="flex h-svh min-h-0 items-center justify-center px-6 pt-10 pb-6">
      <ClientDocumentTitle disableMessageAlert title={t("document.cannotOpen")} />
      <DocumentUnavailableCard message={message} onRetry={onRetry} projectId={projectId} />
    </main>
  )
}

function DocumentUnavailableCard({
  message,
  onRetry,
  projectId,
}: {
  message: DocumentUnavailableMessage
  onRetry?: () => void
  projectId?: string
}) {
  const { t } = useLocale()
  const messageText = "key" in message ? t(message.key) : message.value
  return (
    <div className="max-w-sm space-y-4 border bg-background p-8 text-center">
      <h1 className="text-lg font-semibold">{t("document.cannotOpen")}</h1>
      <p className="text-sm text-muted-foreground">{messageText}</p>
      <div className="flex justify-center gap-2">
        {projectId && (
          <Button asChild variant="outline">
            <Link to={`/projects/${encodeURIComponent(projectId)}/documents`}>
              {t("document.backToProject")}
            </Link>
          </Button>
        )}
        {onRetry && <Button onClick={onRetry}>{t("document.retry")}</Button>}
      </div>
    </div>
  )
}

export default DocumentPage
