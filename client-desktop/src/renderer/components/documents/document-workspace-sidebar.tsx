import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { AppWindow, ArrowLeft, FileText, Folder, FolderOpen, Loader2, Plus } from "lucide-react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { createClientDocument, listClientDocuments } from "@/lib/document-data-api"
import { buildDocumentTree, collectFolderIds, type DocumentTreeNode } from "@/lib/document-tree"
import { cn } from "@/lib/utils"
import { useDesktopTarget } from "@/hooks/use-desktop-target"
import { documentNavigationPath, parseDocumentWindowLocation } from "@/lib/document-window-route"

export function DocumentWorkspaceSidebar({
  activeDocumentId,
  activeTitle,
  getEditVersion,
  onAllowConfirmedNavigation,
  onBeforeNavigate,
  onOpenInWindow,
  openingWindow,
  projectId,
  projectName,
}: {
  activeDocumentId: string
  activeTitle: string
  getEditVersion(): number
  onAllowConfirmedNavigation(): void
  onBeforeNavigate(confirmedVersion?: number): boolean
  onOpenInWindow(): void
  openingWindow: boolean
  projectId: string
  projectName: string
}) {
  const { t } = useLocale()
  const navigate = useNavigate()
  const target = useDesktopTarget()
  const isDocumentWindow = parseDocumentWindowLocation().kind === "document"
  const [creating, setCreating] = React.useState(false)
  const [documents, setDocuments] = React.useState<ReadonlyArray<DocumentTreeNode>>([])
  const [error, setError] = React.useState("")
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const tree = buildDocumentTree(await listClientDocuments(projectId))
      setDocuments(tree)
      setExpanded(new Set(collectFolderIds(tree)))
      setError("")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("document.loadNavFailed"))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  React.useEffect(() => void load(), [load])

  async function createDocument() {
    if (!onBeforeNavigate() || creating) return
    const confirmedVersion = getEditVersion()
    setCreating(true)
    try {
      const created = await createClientDocument(projectId, {
        kind: "document",
        title: t("document.untitled"),
      })
      if (!onBeforeNavigate(confirmedVersion)) return
      onAllowConfirmedNavigation()
      navigate(documentNavigationPath(created.id, target.id))
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : t("document.createFailed"))
    } finally {
      setCreating(false)
    }
  }

  return (
    <aside className="no-drag flex h-full w-full shrink-0 flex-col overflow-hidden bg-background text-foreground">
      {isDocumentWindow ? (
        <div className="mx-2 mt-2 flex h-10 items-center gap-2 rounded-md px-2">
          <ArrowLeft className="size-4" />
          <span className="truncate text-sm font-semibold">{projectName}</span>
        </div>
      ) : (
        <Link
          aria-label={t("document.backToProjectAria", { name: projectName })}
          className="mx-2 mt-2 flex h-10 items-center gap-2 rounded-md px-2 hover:bg-accent focus-visible:ring-2"
          to={`/projects/${encodeURIComponent(projectId)}/documents`}
        >
          <ArrowLeft className="size-4" />
          <span className="truncate text-sm font-semibold">{projectName}</span>
        </Link>
      )}
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
        <Button
          aria-label={isDocumentWindow ? "在新窗口打开当前文档" : "打开当前文档并返回"}
          className="w-full"
          disabled={openingWindow}
          onClick={onOpenInWindow}
          variant="outline"
        >
          {openingWindow ? <Loader2 className="animate-spin" /> : <AppWindow />}
          {isDocumentWindow ? "在新窗口打开当前文档" : "打开当前文档并返回"}
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
            onToggle={(id) =>
              setExpanded((current) => {
                const next = new Set(current)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }
            serverId={target.id}
          />
        )}
      </nav>
    </aside>
  )
}

function SidebarTree({
  activeDocumentId,
  activeTitle,
  depth,
  expanded,
  nodes,
  onToggle,
  serverId,
}: {
  activeDocumentId: string
  activeTitle: string
  depth: number
  expanded: ReadonlySet<string>
  nodes: ReadonlyArray<DocumentTreeNode>
  onToggle(id: string): void
  serverId: string
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
                onToggle={onToggle}
                serverId={serverId}
              />
            )}
          </div>
        ) : (
          <Link
            aria-current={activeDocumentId === node.id ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md pr-2 text-sm hover:bg-accent focus-visible:ring-2",
              activeDocumentId === node.id && "bg-accent font-medium",
            )}
            key={node.id}
            role="treeitem"
            style={{ paddingLeft: depth * 16 + 24 }}
            to={documentNavigationPath(node.id, serverId)}
          >
            <FileText className="size-4 shrink-0 text-sky-600" />
            <span className="truncate">
              {activeDocumentId === node.id ? activeTitle : node.title}
            </span>
          </Link>
        ),
      )}
    </div>
  )
}
