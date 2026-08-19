import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { ArrowLeft, ChevronDown, FileText, Folder, FolderOpen, Loader2, Plus } from "lucide-react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { ProjectAvatar } from "@/components/projects/project-avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { createClientDocument, listClientDocuments } from "@/lib/document-data-api"
import { useDocumentData } from "@/lib/document-data-context"
import { buildDocumentTree, collectFolderIds, type DocumentTreeNode } from "@/lib/document-tree"
import type { ClientProjectSummary } from "@/lib/project-data-api"
import { cn } from "@/lib/utils"
import { useDesktopTarget } from "@/hooks/use-desktop-target"
import {
  documentNavigationPath,
  documentWindowFeedbackKey,
  DocumentWindowOpenError,
  parseDocumentWindowLocation,
  requestDocumentWindow,
} from "@/lib/document-window-route"

export function DocumentWorkspaceSidebar({
  activeDocumentId,
  activeTitle,
  getEditVersion,
  onAllowConfirmedNavigation,
  onBeforeNavigate,
  projectAvatar,
  projectId,
  projectIsPersonal,
  projectName,
}: {
  activeDocumentId: string
  activeTitle: string
  getEditVersion(): number
  onAllowConfirmedNavigation(): void
  onBeforeNavigate(confirmedVersion?: number): boolean
  projectAvatar: string
  projectId: string
  projectIsPersonal: boolean
  projectName: string
}) {
  const { t } = useLocale()
  const {
    loadMoreProjects,
    me,
    personalProject,
    projects,
    projectsLoadingMore,
    projectsNextCursor,
  } = useDocumentData()
  const navigate = useNavigate()
  const target = useDesktopTarget()
  const isDocumentWindow = parseDocumentWindowLocation().kind === "document"
  const currentProject = React.useMemo<ClientProjectSummary>(
    () => ({
      avatar: projectAvatar,
      description: "",
      id: projectId,
      isPersonal: projectIsPersonal,
      name: projectName,
      updatedAt: "",
    }),
    [projectAvatar, projectId, projectIsPersonal, projectName],
  )
  const [selectedProjectId, setSelectedProjectId] = React.useState(projectId)
  const [selectedProjectSnapshot, setSelectedProjectSnapshot] =
    React.useState<ClientProjectSummary>(currentProject)
  const projectOptions = React.useMemo(
    () => mergeProjectOptions(personalProject, projects, currentProject, selectedProjectSnapshot),
    [currentProject, personalProject, projects, selectedProjectSnapshot],
  )
  const selectedProject =
    projectOptions.find((project) => project.id === selectedProjectId) ?? selectedProjectSnapshot
  const [creating, setCreating] = React.useState(false)
  const [documents, setDocuments] = React.useState<ReadonlyArray<DocumentTreeNode>>([])
  const [error, setError] = React.useState("")
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [loading, setLoading] = React.useState(true)
  const [openingDocumentId, setOpeningDocumentId] = React.useState<string>()
  const loadRequestIdRef = React.useRef(0)
  const previousProjectIdRef = React.useRef(projectId)
  const loadedSelectedProject = React.useMemo(
    () =>
      mergeProjectOptions(personalProject, projects, currentProject).find(
        (project) => project.id === selectedProjectId,
      ),
    [currentProject, personalProject, projects, selectedProjectId],
  )

  React.useEffect(() => {
    if (previousProjectIdRef.current === projectId) return
    previousProjectIdRef.current = projectId
    setSelectedProjectId(projectId)
    setSelectedProjectSnapshot(currentProject)
    setDocuments([])
    setExpanded(new Set())
    setError("")
    setLoading(true)
    setOpeningDocumentId(undefined)
  }, [currentProject, projectId])

  React.useEffect(() => {
    if (!loadedSelectedProject) return
    setSelectedProjectSnapshot((current) =>
      current === loadedSelectedProject ? current : loadedSelectedProject,
    )
  }, [loadedSelectedProject])

  async function openDocumentInWindow(documentId: string): Promise<boolean> {
    if (openingDocumentId) return false
    setOpeningDocumentId(documentId)
    try {
      const result = await requestDocumentWindow(documentId, target.id)
      toast.success(
        t(result.status === "focused" ? "documentWindow.focused" : "documentWindow.opened"),
      )
      return true
    } catch (reason) {
      const code = reason instanceof DocumentWindowOpenError ? reason.code : "bridge_unavailable"
      toast.error(t(documentWindowFeedbackKey(code)))
      return false
    } finally {
      setOpeningDocumentId(undefined)
    }
  }

  const load = React.useCallback(async () => {
    const requestId = ++loadRequestIdRef.current
    setLoading(true)
    try {
      const tree = buildDocumentTree(await listClientDocuments(selectedProjectId))
      if (loadRequestIdRef.current !== requestId) return
      setDocuments(tree)
      setExpanded(new Set(collectFolderIds(tree)))
      setError("")
    } catch (loadError) {
      if (loadRequestIdRef.current !== requestId) return
      setError(loadError instanceof Error ? loadError.message : t("document.loadNavFailed"))
    } finally {
      if (loadRequestIdRef.current === requestId) setLoading(false)
    }
  }, [selectedProjectId, t])

  React.useEffect(() => {
    void load()
    return () => {
      loadRequestIdRef.current += 1
    }
  }, [load])

  async function createDocument() {
    if (creating || (!isDocumentWindow && !onBeforeNavigate())) return
    const confirmedVersion = isDocumentWindow ? undefined : getEditVersion()
    setCreating(true)
    try {
      const created = await createClientDocument(selectedProjectId, {
        kind: "document",
        title: t("document.untitled"),
      })
      if (isDocumentWindow) {
        await openDocumentInWindow(created.id)
      } else {
        if (!onBeforeNavigate(confirmedVersion)) return
        onAllowConfirmedNavigation()
        navigate(documentNavigationPath(created.id, target.id))
      }
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : t("document.createFailed"))
    } finally {
      setCreating(false)
    }
  }

  function selectProject(nextProjectId: string) {
    if (nextProjectId === selectedProjectId) return
    const nextProject = projectOptions.find((project) => project.id === nextProjectId)
    if (!nextProject) return
    setSelectedProjectId(nextProjectId)
    setSelectedProjectSnapshot(nextProject)
    setDocuments([])
    setExpanded(new Set())
    setError("")
    setLoading(true)
    setOpeningDocumentId(undefined)
  }

  async function requestMoreProjects() {
    try {
      await loadMoreProjects()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t("document.loadMoreProjectsFailed"))
    }
  }

  return (
    <aside className="no-drag flex h-full w-full shrink-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="mx-2 mt-2 flex h-10 items-center gap-1">
        {!isDocumentWindow && (
          <Button asChild size="icon-sm" variant="ghost">
            <Link
              aria-label={t("document.backToProjectAria", { name: selectedProject.name })}
              to={`/projects/${encodeURIComponent(selectedProject.id)}/documents`}
            >
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("document.switchProject")}
              className="min-w-0 flex-1 justify-start gap-2 px-2"
              variant="ghost"
            >
              <ProjectAvatar className="size-7" project={selectedProject} user={me} />
              <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                {selectedProject.name}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuRadioGroup value={selectedProjectId} onValueChange={selectProject}>
              {projectOptions.map((project) => (
                <DropdownMenuRadioItem key={project.id} value={project.id}>
                  <ProjectAvatar className="size-6" project={project} user={me} />
                  <span className="truncate">{project.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {projectsNextCursor && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={projectsLoadingMore}
                  onSelect={(event) => {
                    event.preventDefault()
                    void requestMoreProjects()
                  }}
                >
                  {projectsLoadingMore && <Loader2 className="animate-spin" />}
                  {t(
                    projectsLoadingMore
                      ? "document.loadingMoreProjects"
                      : "document.loadMoreProjects",
                  )}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="grid gap-2 px-3 py-2">
        <Button
          className="w-full"
          disabled={creating}
          onClick={() => void createDocument()}
          variant="outline"
        >
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          {t("document.newDoc")}
        </Button>
      </div>
      <nav
        aria-label={t("document.projectDocs")}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("document.loading2")}
          </div>
        ) : error ? (
          <div className="space-y-3 px-3 py-8 text-center text-sm text-muted-foreground">
            <p>{error}</p>
            <Button onClick={() => void load()} size="sm" variant="outline">
              {t("document.retry")}
            </Button>
          </div>
        ) : documents.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {t("document.noOthers")}
          </div>
        ) : (
          <SidebarTree
            activeDocumentId={activeDocumentId}
            activeTitle={activeTitle}
            depth={0}
            expanded={expanded}
            nodes={documents}
            onOpenDocument={(documentId) => void openDocumentInWindow(documentId)}
            onToggle={(id) =>
              setExpanded((current) => {
                const next = new Set(current)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }
            serverId={target.id}
            standaloneWindow={isDocumentWindow}
            openingDocumentId={openingDocumentId}
          />
        )}
      </nav>
    </aside>
  )
}

function mergeProjectOptions(
  personalProject: ClientProjectSummary,
  projects: readonly ClientProjectSummary[],
  currentProject: ClientProjectSummary,
  selectedProject?: ClientProjectSummary,
) {
  const projectsById = new Map<string, ClientProjectSummary>()
  projectsById.set(personalProject.id, personalProject)
  for (const project of projects) projectsById.set(project.id, project)
  if (selectedProject && !projectsById.has(selectedProject.id)) {
    projectsById.set(selectedProject.id, selectedProject)
  }
  projectsById.set(currentProject.id, currentProject)
  return Array.from(projectsById.values())
}

function SidebarTree({
  activeDocumentId,
  activeTitle,
  depth,
  expanded,
  nodes,
  onOpenDocument,
  onToggle,
  openingDocumentId,
  serverId,
  standaloneWindow,
}: {
  activeDocumentId: string
  activeTitle: string
  depth: number
  expanded: ReadonlySet<string>
  nodes: ReadonlyArray<DocumentTreeNode>
  onOpenDocument(documentId: string): void
  onToggle(id: string): void
  openingDocumentId?: string
  serverId: string
  standaloneWindow: boolean
}) {
  return (
    <div role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <div key={node.id}>
            <button
              aria-expanded={expanded.has(node.id)}
              className="flex h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-sm hover:bg-accent focus-visible:ring-2"
              onClick={() => onToggle(node.id)}
              role="treeitem"
              style={{ paddingLeft: depth * 16 + 8 }}
              type="button"
            >
              {expanded.has(node.id) ? (
                <FolderOpen className="size-4 text-amber-600" />
              ) : (
                <Folder className="size-4 text-amber-600" />
              )}
              <span className="truncate">{node.title}</span>
            </button>
            {expanded.has(node.id) && (
              <SidebarTree
                activeDocumentId={activeDocumentId}
                activeTitle={activeTitle}
                depth={depth + 1}
                expanded={expanded}
                nodes={node.children}
                onOpenDocument={onOpenDocument}
                onToggle={onToggle}
                openingDocumentId={openingDocumentId}
                serverId={serverId}
                standaloneWindow={standaloneWindow}
              />
            )}
          </div>
        ) : (
          <DocumentSidebarItem
            active={activeDocumentId === node.id}
            depth={depth}
            documentId={node.id}
            key={node.id}
            onOpenDocument={onOpenDocument}
            opening={openingDocumentId === node.id}
            serverId={serverId}
            standaloneWindow={standaloneWindow}
            title={activeDocumentId === node.id ? activeTitle : node.title}
          />
        ),
      )}
    </div>
  )
}

function DocumentSidebarItem({
  active,
  depth,
  documentId,
  onOpenDocument,
  opening,
  serverId,
  standaloneWindow,
  title,
}: {
  active: boolean
  depth: number
  documentId: string
  onOpenDocument(documentId: string): void
  opening: boolean
  serverId: string
  standaloneWindow: boolean
  title: string
}) {
  const className = cn(
    "flex h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-sm hover:bg-accent focus-visible:ring-2",
    active && "bg-accent font-medium",
  )
  const content = (
    <>
      {opening ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-sky-600" />
      ) : (
        <FileText className="size-4 shrink-0 text-sky-600" />
      )}
      <span className="truncate">{title}</span>
    </>
  )

  if (standaloneWindow)
    return (
      <button
        aria-current={active ? "page" : undefined}
        aria-label={active ? title : `在新窗口打开：${title}`}
        className={className}
        disabled={active || opening}
        onClick={() => onOpenDocument(documentId)}
        role="treeitem"
        style={{ paddingLeft: depth * 16 + 8 }}
        type="button"
      >
        {content}
      </button>
    )

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={className}
      role="treeitem"
      style={{ paddingLeft: depth * 16 + 8 }}
      to={documentNavigationPath(documentId, serverId)}
    >
      {content}
    </Link>
  )
}
