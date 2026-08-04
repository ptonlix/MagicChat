import * as React from "react"
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider"
import { FileText, Loader2, Menu, RefreshCw } from "lucide-react"
import { Link, useBlocker, useParams } from "react-router"
import { toast } from "sonner"
import * as Y from "yjs"

import { ClientDocumentTitle } from "@/components/client-document-title"
import { DocumentEditor } from "@/components/documents/document-editor"
import { DocumentWorkspaceSidebar } from "@/components/documents/document-workspace-sidebar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  getClientDocument,
  updateCollaborativeDocumentTitle,
  type ClientDocument,
} from "@/lib/document-data-api"
import {
  createDocumentWebSocketPolyfill,
  DocumentCollaborationProviderWebsocket,
} from "@/lib/document-collaboration-socket"
import { DocumentBodySyncController, type DocumentBodySyncSnapshot } from "@/lib/document-body-sync"
import { useDesktopTarget } from "@/hooks/use-desktop-target"
import {
  DocumentTitleController,
  limitDocumentTitle,
  normalizeDocumentTitle,
  type DocumentTitleSnapshot,
} from "@/lib/document-title-controller"
import { getClientProject, type ClientProjectDetail } from "@/lib/project-data-api"
import { useClientData } from "@/lib/client-data-context"

type Loaded = Readonly<{ document: ClientDocument; project: ClientProjectDetail }>
export function DocumentPage() {
  const { documentId = "" } = useParams<{ documentId: string }>()
  const [loaded, setLoaded] = React.useState<Loaded>()
  const [error, setError] = React.useState("")
  const [retry, setRetry] = React.useState(0)

  React.useEffect(() => {
    const controller = new AbortController()
    setLoaded(undefined)
    setError("")
    if (!documentId) {
      setError("文档标识无效")
      return () => controller.abort()
    }
    void getClientDocument(documentId, fetch, controller.signal)
      .then(async (document) => {
        if (document.kind !== "document" || document.documentType !== "document")
          throw new Error("该节点不是可编辑文档")
        const project = await getClientProject(document.projectId)
        if (!controller.signal.aborted) setLoaded({ document, project })
      })
      .catch((loadError) => {
        if (!controller.signal.aborted)
          setError(loadError instanceof Error ? loadError.message : "加载文档失败")
      })
    return () => controller.abort()
  }, [documentId, retry])

  if (error)
    return (
      <DocumentUnavailable
        message={error}
        onRetry={() => setRetry((value) => value + 1)}
        projectId={loaded?.document.projectId}
      />
    )
  if (!loaded) return <DocumentLoading />
  return (
    <DocumentWorkspace
      document={loaded.document}
      key={loaded.document.id}
      project={loaded.project}
    />
  )
}

function DocumentWorkspace({
  document,
  project,
}: {
  document: ClientDocument
  project: ClientProjectDetail
}) {
  const target = useDesktopTarget()
  const { refreshMe, refreshProjects } = useClientData()
  const [ydoc] = React.useState(() => new Y.Doc())
  const [bodyController] = React.useState(() => new DocumentBodySyncController())
  const [body, setBody] = React.useState<DocumentBodySyncSnapshot>(bodyController.value)
  const [permissionDenied, setPermissionDenied] = React.useState(false)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const titleController = React.useMemo(
    () =>
      new DocumentTitleController(document.title, (title) =>
        updateCollaborativeDocumentTitle(document.id, title),
      ),
    [document.id, document.title],
  )
  const [title, setTitle] = React.useState<DocumentTitleSnapshot>(titleController.value)
  const titleText = normalizeDocumentTitle(title.input)
  const dirty = titleController.dirty || body.unsyncedChanges > 0
  const allowNextNavigation = React.useRef(false)
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
  React.useEffect(() => () => titleController.destroy(), [titleController])

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
      void Promise.allSettled([refreshProjects(), refreshMe()])
    }
    const websocketProvider = new DocumentCollaborationProviderWebsocket({
      WebSocketPolyfill: createDocumentWebSocketPolyfill(target, document.id),
      url: "desktop://document-collaboration",
    })
    collaboration.websocketProvider = websocketProvider
    const provider = new HocuspocusProvider({
      document: ydoc,
      name: document.id,
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
      sharedTitle.unobserve(observeTitle)
      stopCollaboration()
      ydoc.destroy()
    }
  }, [bodyController, document.id, refreshMe, refreshProjects, target, titleController, ydoc])

  React.useEffect(() => {
    if (blocker.state !== "blocked") return
    if (window.confirm("文档尚未同步完成，确定要离开吗？")) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  React.useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
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
      window.confirm("文档尚未同步完成，确定要离开吗？"),
    [titleController],
  )
  const getEditVersion = React.useCallback(() => editVersion.current, [])
  const allowConfirmedNavigation = React.useCallback(() => {
    allowNextNavigation.current = true
  }, [])
  const saveTitle = () => void titleController.flush().catch(() => toast.error("保存文档标题失败"))

  if (permissionDenied)
    return (
      <DocumentUnavailable
        message="当前账号无权访问该文档，项目权限可能已被撤销。"
        projectId={document.projectId}
      />
    )

  const sidebar = (
    <DocumentWorkspaceSidebar
      activeDocumentId={document.id}
      activeTitle={titleText}
      getEditVersion={getEditVersion}
      onAllowConfirmedNavigation={allowConfirmedNavigation}
      onBeforeNavigate={confirmLeave}
      projectId={project.id}
      projectName={project.name}
    />
  )
  return (
    <main className="no-drag flex h-svh min-h-0 min-w-0 overflow-hidden bg-muted/40 pt-10">
      <ClientDocumentTitle disableMessageAlert title={titleText} />
      <aside className="hidden w-72 shrink-0 border-r md:block">{sidebar}</aside>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background/40">
        <header className="no-drag flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3 sm:px-5">
          <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
            <SheetTrigger asChild>
              <Button
                aria-label="打开文档导航"
                className="md:hidden"
                size="icon-sm"
                variant="ghost"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent className="w-72 px-0 pt-10 pb-0" side="left">
              <SheetTitle className="sr-only">项目文档导航</SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>
          <FileText className="size-5 shrink-0 text-sky-600" />
          <input
            aria-label="顶部文档标题"
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none"
            onBlur={saveTitle}
            onChange={(event) => {
              editVersion.current += 1
              titleController.change(limitDocumentTitle(event.target.value))
            }}
            placeholder="无标题文档"
            value={title.input}
          />
          <span
            aria-live="polite"
            className="hidden shrink-0 text-xs text-muted-foreground lg:inline"
          >
            {title.state === "failed"
              ? "标题保存失败"
              : title.state === "saving"
                ? "标题保存中"
                : title.state === "pending"
                  ? "标题待保存"
                  : "标题已自动保存"}{" "}
            ·{" "}
            {body.state === "connecting"
              ? "正文连接中"
              : body.state === "saving"
                ? "正文同步中"
                : body.state === "failed"
                  ? "正文同步失败"
                  : "正文已同步"}
          </span>
          {title.state === "failed" && (
            <Button aria-label="重试保存标题" onClick={saveTitle} size="icon-sm" variant="ghost">
              <RefreshCw />
            </Button>
          )}
        </header>
        <DocumentEditor
          collaborationDocument={ydoc}
          onTitleBlur={saveTitle}
          onTitleChange={(value) => {
            editVersion.current += 1
            titleController.change(value)
          }}
          title={title.input}
        />
      </section>
    </main>
  )
}

function DocumentLoading() {
  return (
    <main className="flex h-svh min-h-0 items-center justify-center gap-2 pt-10 text-sm text-muted-foreground">
      <ClientDocumentTitle disableMessageAlert title="正在加载文档" />
      <Loader2 className="size-4 animate-spin" />
      正在加载文档
    </main>
  )
}

function DocumentUnavailable({
  message,
  onRetry,
  projectId,
}: {
  message: string
  onRetry?: () => void
  projectId?: string
}) {
  return (
    <main className="flex h-svh min-h-0 items-center justify-center px-6 pt-10 pb-6">
      <ClientDocumentTitle disableMessageAlert title="无法打开文档" />
      <div className="max-w-sm space-y-4 border bg-background p-8 text-center">
        <h1 className="text-lg font-semibold">无法打开文档</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex justify-center gap-2">
          {projectId && (
            <Button asChild variant="outline">
              <Link to={`/projects/${encodeURIComponent(projectId)}`}>返回项目</Link>
            </Button>
          )}
          {onRetry && <Button onClick={onRetry}>重试</Button>}
        </div>
      </div>
    </main>
  )
}

export default DocumentPage
