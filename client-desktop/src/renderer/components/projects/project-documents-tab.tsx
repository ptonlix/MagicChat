import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  Ellipsis,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { createPortal } from "react-dom"
import { Link } from "react-router"
import { toast } from "sonner"

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
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  createClientDocument,
  deleteClientDocument,
  listClientDocuments,
  moveClientDocument,
  updateClientDocument,
  updateCollaborativeDocumentTitle,
  formatDocumentModifiedTime,
  type ClientDocumentKind,
} from "@/lib/document-data-api"
import {
  buildDocumentTree,
  collectDocumentNodeIds,
  collectFolderIds,
  filterDocumentTree,
  findDocumentNode,
  flattenLocations,
  moveDocumentNode,
  parseDocumentDropTarget,
  type DocumentDropTarget,
  type DocumentTreeNode,
} from "@/lib/document-tree"
import { cn } from "@/lib/utils"
import { limitDocumentTitle } from "@/lib/document-title-controller"
import { DesktopTargetContext } from "@/lib/desktop-target-context"
import {
  documentWindowFeedbackMessage,
  DocumentWindowOpenError,
  requestDocumentWindow,
} from "@/lib/document-window-route"

type EditDialogState =
  | Readonly<{ kind: ClientDocumentKind; mode: "create"; parentId: string | null }>
  | Readonly<{ mode: "rename"; node: DocumentTreeNode }>
  | null

export function ProjectDocumentsTab({ projectId }: { projectId: string }) {
  const { t } = useLocale()
  const target = React.useContext(DesktopTargetContext)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [deleteNode, setDeleteNode] = React.useState<DocumentTreeNode | null>(null)
  const [documentTree, setDocumentTree] = React.useState<ReadonlyArray<DocumentTreeNode>>([])
  const [editDialog, setEditDialog] = React.useState<EditDialogState>(null)
  const [error, setError] = React.useState("")
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(() => new Set())
  const [keyword, setKeyword] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [mutating, setMutating] = React.useState(false)
  const [openingWindowId, setOpeningWindowId] = React.useState<string | null>(null)
  const requestRef = React.useRef<AbortController | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const loadDocuments = React.useCallback(
    async (expandFolders = false) => {
      requestRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      setLoading(true)
      try {
        const documents = await listClientDocuments(projectId, fetch, controller.signal)
        if (controller.signal.aborted) return
        const tree = buildDocumentTree(documents)
        setDocumentTree(tree)
        if (expandFolders) setExpandedFolderIds(new Set(collectFolderIds(tree)))
        setError("")
      } catch (loadError) {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : t("docTab.loadFailed"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [projectId, t],
  )

  React.useEffect(() => {
    void loadDocuments(true)
    return () => requestRef.current?.abort()
  }, [loadDocuments])

  React.useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadDocuments()
    }
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible)
  }, [loadDocuments])

  const searching = keyword.trim().length > 0
  const visibleTree = searching ? filterDocumentTree(documentTree, keyword) : documentTree
  const activeNode = activeId ? findDocumentNode(documentTree, activeId) : undefined
  const blockedParentIds = activeNode ? collectDocumentNodeIds(activeNode) : new Set<string>()

  async function submitEdit(title: string) {
    if (!editDialog || mutating) return
    setMutating(true)
    try {
      if (editDialog.mode === "create") {
        const created = await createClientDocument(projectId, {
          kind: editDialog.kind,
          parentId: editDialog.parentId,
          title,
        })
        if (editDialog.parentId) {
          setExpandedFolderIds((current) => new Set(current).add(editDialog.parentId as string))
        }
        toast.success(
          created.kind === "folder" ? t("docTab.folderCreated") : t("docTab.docCreated"),
        )
      } else if (editDialog.node.kind === "document") {
        await updateCollaborativeDocumentTitle(editDialog.node.id, title)
        toast.success(t("docTab.titleUpdated"))
      } else {
        await updateClientDocument(editDialog.node.id, { title })
        toast.success(t("docTab.folderNameUpdated"))
      }
      setEditDialog(null)
      await loadDocuments()
    } catch (mutationError) {
      toast.error(
        mutationError instanceof Error ? mutationError.message : t("docTab.operationFailed"),
      )
    } finally {
      setMutating(false)
    }
  }

  async function confirmDelete() {
    if (!deleteNode || mutating) return
    setMutating(true)
    try {
      const result = await deleteClientDocument(deleteNode.id)
      toast.success(
        result.deletedCount > 1
          ? t("docTab.deletedMany", { count: result.deletedCount })
          : t("docTab.deletedOne"),
      )
      setDeleteNode(null)
      await loadDocuments()
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : t("docTab.deleteFailed"))
    } finally {
      setMutating(false)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const target = parseDocumentDropTarget(event.over?.data.current)
    const draggedId = String(event.active.id)
    setActiveId(null)
    if (!target || mutating) return
    const next = moveDocumentNode(documentTree, draggedId, target)
    if (next === documentTree) return
    setDocumentTree(next)
    if (target.kind === "folder") {
      setExpandedFolderIds((current) => new Set(current).add(target.folderId))
    }
    const location = flattenLocations(next).get(draggedId)
    if (!location) return
    setMutating(true)
    void moveClientDocument(draggedId, location)
      .then(() => {
        toast.success(t("docTab.moved"))
        return loadDocuments()
      })
      .catch(async (mutationError: unknown) => {
        toast.error(mutationError instanceof Error ? mutationError.message : t("docTab.moveFailed"))
        await loadDocuments()
      })
      .finally(() => setMutating(false))
  }

  async function openDocumentInWindow(node: DocumentTreeNode) {
    if (node.kind !== "document" || openingWindowId) return
    if (!target) {
      toast.error("当前窗口缺少服务器认证目标")
      return
    }
    setOpeningWindowId(node.id)
    try {
      const result = await requestDocumentWindow(node.id, target.id)
      toast.success(result.status === "focused" ? "已聚焦已有文档窗口" : "文档窗口已打开")
    } catch (reason) {
      const code = reason instanceof DocumentWindowOpenError ? reason.code : "bridge_unavailable"
      toast.error(
        documentWindowFeedbackMessage(
          code,
          reason instanceof Error ? reason.message : "文档窗口暂时不可用",
        ),
      )
    } finally {
      setOpeningWindowId(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/10">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4">
        <DocumentToolbar
          disabled={mutating}
          keyword={keyword}
          onCreate={(kind) => setEditDialog({ kind, mode: "create", parentId: null })}
          onKeywordChange={setKeyword}
        />
        <DndContext
          collisionDetection={pointerWithin}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={handleDragEnd}
          onDragStart={(event) => setActiveId(String(event.active.id))}
          sensors={sensors}
        >
          {loading ? (
            <DocumentState
              icon={<Loader2 className="animate-spin" />}
              title={t("docTab.loading")}
            />
          ) : error ? (
            <DocumentState
              action={
                <Button onClick={() => void loadDocuments(true)} variant="outline">
                  {t("docTab.retry")}
                </Button>
              }
              title={error}
            />
          ) : visibleTree.length === 0 ? (
            <DocumentState
              action={
                !searching ? (
                  <Button
                    onClick={() =>
                      setEditDialog({ kind: "document", mode: "create", parentId: null })
                    }
                  >
                    <Plus />
                    {t("docTab.createDoc")}
                  </Button>
                ) : undefined
              }
              icon={<FileText />}
              title={searching ? t("docTab.noMatch") : t("docTab.empty")}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-background shadow-xs">
              <div className="min-w-192 py-2" role="tree">
                <DocumentTree
                  activeId={activeId}
                  blockedParentIds={blockedParentIds}
                  depth={0}
                  disabled={mutating || searching}
                  expandedFolderIds={expandedFolderIds}
                  nodes={visibleTree}
                  onCreate={(kind, parentId) => setEditDialog({ kind, mode: "create", parentId })}
                  onDelete={setDeleteNode}
                  onFolderOpenChange={(id, open) =>
                    setExpandedFolderIds((current) => {
                      const next = new Set(current)
                      if (open) next.add(id)
                      else next.delete(id)
                      return next
                    })
                  }
                  onRename={(node) => setEditDialog({ mode: "rename", node })}
                  onOpenWindow={(node) => void openDocumentInWindow(node)}
                  openingWindowId={openingWindowId}
                  parentId={null}
                  searching={searching}
                />
              </div>
            </div>
          )}
          {typeof document !== "undefined" &&
            createPortal(
              <DragOverlay dropAnimation={null}>
                {activeNode && <DocumentDragOverlay node={activeNode} />}
              </DragOverlay>,
              document.body,
            )}
        </DndContext>
      </div>
      {editDialog && (
        <DocumentEditDialog
          disabled={mutating}
          key={
            editDialog.mode === "rename"
              ? editDialog.node.id
              : `${editDialog.kind}:${editDialog.parentId}`
          }
          onOpenChange={(open) => !open && setEditDialog(null)}
          onSubmit={submitEdit}
          state={editDialog}
        />
      )}
      <AlertDialog onOpenChange={(open) => !open && setDeleteNode(null)} open={deleteNode !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(deleteNode?.kind === "folder" ? "docTab.deleteFolder" : "docTab.deleteDoc")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteNode?.kind === "folder"
                ? t("docTab.deleteFolderDesc", {
                    count: Math.max(collectDocumentNodeIds(deleteNode).size - 1, 0),
                  })
                : t("docTab.deleteDocDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutating}>{t("docTab.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={mutating} onClick={() => void confirmDelete()}>
              {mutating ? t("docTab.deleting") : t("docTab.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DocumentToolbar({
  disabled,
  keyword,
  onCreate,
  onKeywordChange,
}: {
  disabled: boolean
  keyword: string
  onCreate: (kind: ClientDocumentKind) => void
  onKeywordChange: (keyword: string) => void
}) {
  const { t } = useLocale()
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div className="relative min-w-52 sm:min-w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t("docTab.search")}
          className="pl-8"
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder={t("docTab.search")}
          type="search"
          value={keyword}
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={disabled} type="button">
            <Plus />
            {t("docTab.create")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onCreate("document")}>
            <FileText />
            {t("docTree.newDoc")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate("folder")}>
            <FolderPlus />
            {t("docTree.newFolder")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DocumentTree(props: {
  activeId: string | null
  blockedParentIds: ReadonlySet<string>
  depth: number
  disabled: boolean
  expandedFolderIds: ReadonlySet<string>
  nodes: ReadonlyArray<DocumentTreeNode>
  onCreate: (kind: ClientDocumentKind, parentId: string) => void
  onDelete: (node: DocumentTreeNode) => void
  onFolderOpenChange: (folderId: string, open: boolean) => void
  onOpenWindow: (node: DocumentTreeNode) => void
  onRename: (node: DocumentTreeNode) => void
  openingWindowId: string | null
  parentId: string | null
  searching: boolean
}) {
  return (
    <>
      {props.nodes.map((node, index) => (
        <React.Fragment key={node.id}>
          <DocumentDropPosition
            depth={props.depth}
            disabled={
              props.activeId === null ||
              props.disabled ||
              (props.parentId !== null && props.blockedParentIds.has(props.parentId))
            }
            index={index}
            parentId={props.parentId}
          />
          <DocumentTreeItem
            {...props}
            node={node}
            target={
              node.kind === "folder"
                ? { folderId: node.id, kind: "folder" }
                : { index: index + 1, kind: "position", parentId: props.parentId }
            }
          />
        </React.Fragment>
      ))}
      <DocumentDropPosition
        depth={props.depth}
        disabled={
          props.activeId === null ||
          props.disabled ||
          (props.parentId !== null && props.blockedParentIds.has(props.parentId))
        }
        index={props.nodes.length}
        parentId={props.parentId}
      />
    </>
  )
}

function DocumentTreeItem(
  props: React.ComponentProps<typeof DocumentTree> & {
    node: DocumentTreeNode
    target: DocumentDropTarget
  },
) {
  const open =
    props.node.kind === "folder" && (props.searching || props.expandedFolderIds.has(props.node.id))
  return (
    <Collapsible
      disabled={props.node.kind !== "folder"}
      onOpenChange={(value) => !props.searching && props.onFolderOpenChange(props.node.id, value)}
      open={open}
    >
      <DocumentTreeRow {...props} open={open} />
      {props.node.kind === "folder" && (
        <CollapsibleContent role="group">
          <DocumentTree
            {...props}
            depth={props.depth + 1}
            nodes={props.node.children}
            parentId={props.node.id}
          />
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

function DocumentTreeRow(props: React.ComponentProps<typeof DocumentTreeItem> & { open: boolean }) {
  const { t } = useLocale()
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef: setDragRef,
  } = useDraggable({ disabled: props.disabled, id: props.node.id })
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    data: props.target,
    disabled:
      props.activeId === null ||
      props.activeId === props.node.id ||
      props.disabled ||
      (props.node.kind === "folder" && props.blockedParentIds.has(props.node.id)),
    id: `${props.node.kind}:${props.node.id}`,
  })
  const setRowRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setDragRef(element)
      setDropRef(element)
    },
    [setDragRef, setDropRef],
  )
  const Icon = props.node.kind === "folder" ? (props.open ? FolderOpen : Folder) : FileText
  const name = (
    <>
      <Icon
        className={cn(
          "size-5 shrink-0",
          props.node.kind === "folder" ? "text-amber-600" : "text-sky-600",
        )}
      />
      <span className="truncate font-medium">{props.node.title}</span>
    </>
  )
  return (
    <div
      ref={setRowRef}
      aria-expanded={props.node.kind === "folder" ? props.open : undefined}
      aria-level={props.depth + 1}
      className={cn(
        "group grid min-h-12 grid-cols-[minmax(18rem,1fr)_16rem] items-center text-sm hover:bg-muted/50",
        isDragging && "opacity-40",
        isOver && "bg-sky-50 ring-1 ring-sky-300 ring-inset dark:bg-sky-950/30",
      )}
      role="treeitem"
    >
      <div className="flex min-w-0 items-center pr-3" style={{ paddingLeft: props.depth * 24 + 8 }}>
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("docTree.dragAria", { title: props.node.title })}
          className="mr-1 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100"
          disabled={props.disabled}
          type="button"
        >
          <GripVertical className="size-4" />
        </button>
        {props.node.kind === "folder" ? (
          <CollapsibleTrigger asChild>
            <button
              className="flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:ring-2"
              type="button"
            >
              {name}
            </button>
          </CollapsibleTrigger>
        ) : (
          <Link
            className="flex min-w-0 items-center gap-2 rounded-sm focus-visible:ring-2"
            to={`/documents/document/${encodeURIComponent(props.node.id)}`}
          >
            {name}
          </Link>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-3 pr-3 text-muted-foreground">
        <div
          aria-label={`${props.node.contributorCount} 位贡献者`}
          className="no-drag flex shrink-0 -space-x-2"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {props.node.contributors.slice(0, 5).map((user) => (
            <Avatar className="size-6 border-2 border-background" key={user.id}>
              {user.avatar && <AvatarImage alt={user.nickname || user.name} src={user.avatar} />}
              <AvatarFallback className="text-[10px]">
                {Array.from(user.nickname || user.name)[0] ?? "?"}
              </AvatarFallback>
            </Avatar>
          ))}
          {props.node.contributorCount > 5 && (
            <span className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px]">
              +{props.node.contributorCount - 5}
            </span>
          )}
        </div>
        <time className="truncate text-xs" dateTime={props.node.updatedAt}>
          {formatDocumentModifiedTime(props.node.updatedAt)}
        </time>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("docTree.actionsAria", { title: props.node.title })}
              size="icon-xs"
              variant="ghost"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {props.node.kind === "folder" && (
              <>
                <DropdownMenuItem onSelect={() => props.onCreate("document", props.node.id)}>
                  <FileText />
                  {t("docTree.newChildDoc")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => props.onCreate("folder", props.node.id)}>
                  <FolderPlus />
                  {t("docTree.newChildFolder")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => props.onRename(props.node)}>
              <Pencil />
              {t("docTree.rename")}
            </DropdownMenuItem>
            {props.node.kind === "document" && (
              <DropdownMenuItem
                disabled={props.openingWindowId === props.node.id}
                onSelect={() => props.onOpenWindow(props.node)}
              >
                <ExternalLink />
                在新窗口打开
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => props.onDelete(props.node)}
            >
              <Trash2 />
              {t("docTree.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function DocumentDropPosition({
  depth,
  disabled,
  index,
  parentId,
}: {
  depth: number
  disabled: boolean
  index: number
  parentId: string | null
}) {
  const { isOver, setNodeRef } = useDroppable({
    data: { index, kind: "position", parentId } satisfies DocumentDropTarget,
    disabled,
    id: `position:${parentId ?? "root"}:${index}`,
  })
  return (
    <div className="relative z-10 h-0">
      <div
        ref={setNodeRef}
        className={cn(
          "absolute top-0 right-3 h-3 -translate-y-1/2",
          disabled && "pointer-events-none",
        )}
        style={{ left: depth * 24 + 12 }}
      >
        <div
          className={cn(
            "absolute top-1/2 right-0 left-0 h-0.5 -translate-y-1/2",
            isOver && "bg-teal-500",
          )}
        />
      </div>
    </div>
  )
}

function DocumentEditDialog({
  disabled,
  onOpenChange,
  onSubmit,
  state,
}: {
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (title: string) => Promise<void>
  state: Exclude<EditDialogState, null>
}) {
  const { t } = useLocale()
  const [title, setTitle] = React.useState(state.mode === "rename" ? state.node.title : "")
  const kind = state.mode === "create" ? state.kind : state.node.kind
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.mode === "rename"
              ? t("docTree.rename")
              : kind === "folder"
                ? t("docTree.newFolder")
                : t("docTree.newDoc")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim()) void onSubmit(title)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="document-title">
              {kind === "folder" ? t("docTree.folderName") : t("docTree.docTitle")}
            </Label>
            <Input
              autoFocus
              id="document-title"
              onChange={(event) => setTitle(limitDocumentTitle(event.target.value))}
              value={title}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={disabled}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("docTree.cancel")}
            </Button>
            <Button disabled={disabled || !title.trim()} type="submit">
              {disabled ? t("docTree.saving") : t("docTree.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DocumentState({
  action,
  icon,
  title,
}: {
  action?: React.ReactNode
  icon?: React.ReactNode
  title: string
}) {
  return (
    <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 rounded-md border bg-background p-8 text-sm text-muted-foreground">
      <span aria-hidden="true">{icon}</span>
      <p>{title}</p>
      {action}
    </div>
  )
}

function DocumentDragOverlay({ node }: { node: DocumentTreeNode }) {
  const Icon = node.kind === "folder" ? Folder : FileText
  return (
    <div className="flex w-72 items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-lg">
      <GripVertical className="size-4 text-muted-foreground" />
      <Icon className="size-5" />
      <span className="truncate text-sm font-medium">{node.title}</span>
    </div>
  )
}
