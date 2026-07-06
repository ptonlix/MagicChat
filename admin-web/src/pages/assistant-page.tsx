import {
  ArrowDownIcon,
  ArrowUpIcon,
  BanIcon,
  CheckIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useEffect, useId, useState, type FormEvent } from "react"
import { toast } from "sonner"

import {
  AdminAssistantRequestError,
  checkLLMModelHealth,
  createLLMModel,
  deleteLLMModel,
  discoverLLMModels,
  disableLLMModel,
  enableLLMModel,
  type DiscoveredLLMModel,
  type LLMConnectivityStatus,
  type LLMModel,
  type LLMModelInput,
  type LLMModelMoveDirection,
  listLLMModels,
  moveLLMModel,
  updateLLMModel,
} from "@/lib/admin-assistant"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type LLMModelForm = {
  apiKey: string
  baseUrl: string
  displayName: string
  modelName: string
}

export default function AssistantPage() {
  const [copyingModel, setCopyingModel] = useState<LLMModel | null>(null)
  const [deleteConfirmationModel, setDeleteConfirmationModel] =
    useState<LLMModel | null>(null)
  const [editingModel, setEditingModel] = useState<LLMModel | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [models, setModels] = useState<LLMModel[]>([])
  const [updatingModelId, setUpdatingModelId] = useState<string | null>(null)
  const isDeletingModel =
    deleteConfirmationModel !== null &&
    updatingModelId === deleteConfirmationModel.id

  useEffect(() => {
    let ignore = false

    async function loadModels() {
      setIsLoading(true)

      try {
        const loadedModels = await listLLMModels()

        if (ignore) {
          return
        }

        setModels(sortLLMModelsForDisplay(loadedModels))
      } catch (error) {
        if (ignore) {
          return
        }

        toast.error(
          error instanceof AdminAssistantRequestError
            ? error.message
            : "加载大模型失败"
        )
      } finally {
        if (!ignore) {
          setIsLoading(false)
        }
      }
    }

    void loadModels()

    return () => {
      ignore = true
    }
  }, [])

  function handleDialogOpenChange(open: boolean) {
    setIsDialogOpen(open)
    if (!open) {
      setCopyingModel(null)
      setEditingModel(null)
    }
  }

  function openEditForm(model: LLMModel) {
    setCopyingModel(null)
    setEditingModel(model)
    setIsDialogOpen(true)
  }

  function openCopyForm(model: LLMModel) {
    setEditingModel(null)
    setCopyingModel(model)
    setIsDialogOpen(true)
  }

  function openDeleteConfirmation(model: LLMModel) {
    setDeleteConfirmationModel(model)
  }

  function handleDeleteConfirmationOpenChange(open: boolean) {
    if (!open && !isDeletingModel) {
      setDeleteConfirmationModel(null)
    }
  }

  function handleModelSaved(model: LLMModel) {
    setModels((currentModels) =>
      sortLLMModelsForDisplay([
        model,
        ...currentModels.filter((currentModel) => currentModel.id !== model.id),
      ])
    )
    handleDialogOpenChange(false)
  }

  async function handleModelDelete(model: LLMModel) {
    setUpdatingModelId(model.id)

    try {
      await deleteLLMModel(model.id)
      setModels((currentModels) =>
        currentModels.filter((currentModel) => currentModel.id !== model.id)
      )
      if (editingModel?.id === model.id) {
        handleDialogOpenChange(false)
      }
      setDeleteConfirmationModel(null)
      toast.success("大模型已删除")
    } catch (error) {
      toast.error(
        error instanceof AdminAssistantRequestError
          ? error.message
          : "删除大模型失败"
      )
    } finally {
      setUpdatingModelId(null)
    }
  }

  async function handleConfirmModelDelete() {
    if (deleteConfirmationModel === null) {
      return
    }

    await handleModelDelete(deleteConfirmationModel)
  }

  async function handleModelStatusChange(model: LLMModel, enabled: boolean) {
    setUpdatingModelId(model.id)

    try {
      const updatedModel = enabled
        ? await enableLLMModel(model.id)
        : await disableLLMModel(model.id)

      upsertModel(updatedModel)
      toast.success(enabled ? "大模型已启用" : "大模型已禁用")
    } catch (error) {
      toast.error(
        error instanceof AdminAssistantRequestError
          ? error.message
          : "更新大模型状态失败"
      )
    } finally {
      setUpdatingModelId(null)
    }
  }

  async function handleModelMove(
    model: LLMModel,
    direction: LLMModelMoveDirection
  ) {
    setUpdatingModelId(model.id)

    try {
      const movedModels = await moveLLMModel(model.id, direction)
      setModels(sortLLMModelsForDisplay(movedModels))
      toast.success("大模型排序已更新")
    } catch (error) {
      toast.error(
        error instanceof AdminAssistantRequestError
          ? error.message
          : "移动大模型失败"
      )
    } finally {
      setUpdatingModelId(null)
    }
  }

  async function handleModelHealthCheck(model: LLMModel) {
    setUpdatingModelId(model.id)

    try {
      const checkedModel = await checkLLMModelHealth(model.id)
      upsertModel(checkedModel)
      toast.success(
        checkedModel.connectivityStatus === "connected"
          ? "大模型连接正常"
          : "大模型连接失败"
      )
    } catch (error) {
      toast.error(
        error instanceof AdminAssistantRequestError
          ? error.message
          : "检测大模型失败"
      )
    } finally {
      setUpdatingModelId(null)
    }
  }

  function upsertModel(model: LLMModel) {
    setModels((currentModels) =>
      sortLLMModelsForDisplay(
        currentModels.map((currentModel) =>
          currentModel.id === model.id ? model : currentModel
        )
      )
    )
  }

  return (
    <>
      <div className="grid min-w-0 flex-1 items-start gap-4 p-4 pt-0">
        <Card className="w-full">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>大模型</CardTitle>
              <LLMModelDialog
                copyingModel={copyingModel}
                disabled={isLoading}
                editingModel={editingModel}
                onModelSaved={handleModelSaved}
                onOpenChange={handleDialogOpenChange}
                open={isDialogOpen}
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className={getLLMModelsTableContainerClassName()}>
              <Table className={getLLMModelsTableClassName()}>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className={getLLMModelColumnClassName("displayName")}
                    >
                      显示名称
                    </TableHead>
                    <TableHead
                      className={getLLMModelColumnClassName("modelName")}
                    >
                      模型名称
                    </TableHead>
                    <TableHead
                      className={getLLMModelColumnClassName("baseUrl")}
                    >
                      Base URL
                    </TableHead>
                    <TableHead className={getLLMModelColumnClassName("status")}>
                      状态
                    </TableHead>
                    <TableHead
                      className={getLLMModelColumnClassName("actions")}
                    >
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.length === 0 ? (
                    <TableRow>
                      <TableCell className="h-24 text-center" colSpan={5}>
                        {isLoading ? "加载中" : "暂无大模型"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    models.map((model, index) => (
                      <TableRow
                        className={getLLMModelRowClassName(model.enabled)}
                        key={model.id}
                      >
                        <TableCell
                          className={getLLMModelColumnClassName("displayName")}
                        >
                          <div className="truncate font-medium">
                            {model.displayName}
                          </div>
                        </TableCell>
                        <TableCell
                          className={getLLMModelColumnClassName("modelName")}
                        >
                          <div className="truncate">{model.modelName}</div>
                        </TableCell>
                        <TableCell
                          className={getLLMModelColumnClassName("baseUrl")}
                        >
                          <div className="truncate">{model.baseUrl}</div>
                        </TableCell>
                        <TableCell
                          className={getLLMModelColumnClassName("status")}
                        >
                          <div className="flex items-center gap-2">
                            <LLMModelStatusBadge model={model} />
                          </div>
                        </TableCell>
                        <TableCell
                          className={getLLMModelColumnClassName("actions")}
                        >
                          <LLMModelActions
                            isFirst={index === 0}
                            isLast={index === models.length - 1}
                            isUpdating={updatingModelId === model.id}
                            model={model}
                            onCopy={openCopyForm}
                            onDelete={openDeleteConfirmation}
                            onEdit={openEditForm}
                            onHealthCheck={handleModelHealthCheck}
                            onMove={handleModelMove}
                            onStatusChange={handleModelStatusChange}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
      <AlertDialog
        onOpenChange={handleDeleteConfirmationOpenChange}
        open={deleteConfirmationModel !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除大模型</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将无法继续使用
              {deleteConfirmationModel
                ? ` ${deleteConfirmationModel.displayName} `
                : "这个大模型"}
              ，这个操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingModel}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingModel}
              onClick={handleConfirmModelDelete}
              variant="destructive"
            >
              {isDeletingModel ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function LLMModelStatusBadge({ model }: { model: LLMModel }) {
  const badge = (
    <Badge
      className={getLLMModelStatusBadgeClassName(
        model.connectivityStatus,
        model.enabled
      )}
      variant="secondary"
    >
      {getLLMModelStatusBadgeText(model)}
    </Badge>
  )

  if (!model.enabled || model.connectivityStatus !== "failed") {
    return badge
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {badge}
      </TooltipTrigger>
      <TooltipContent className="max-w-[min(28rem,calc(100vw-2rem))] text-left break-all whitespace-pre-wrap">
        {model.lastErrorMessage || "未知错误"}
      </TooltipContent>
    </Tooltip>
  )
}

function LLMModelActions({
  isFirst,
  isLast,
  isUpdating,
  model,
  onCopy,
  onDelete,
  onEdit,
  onHealthCheck,
  onMove,
  onStatusChange,
}: {
  isFirst: boolean
  isLast: boolean
  isUpdating: boolean
  model: LLMModel
  onCopy: (model: LLMModel) => void
  onDelete: (model: LLMModel) => void
  onEdit: (model: LLMModel) => void
  onHealthCheck: (model: LLMModel) => void
  onMove: (model: LLMModel, direction: LLMModelMoveDirection) => void
  onStatusChange: (model: LLMModel, enabled: boolean) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`打开 ${model.displayName} 的操作菜单`}
            size="icon-xs"
            type="button"
            variant="ghost"
          />
        }
      >
        <span className="sr-only">Open menu</span>
        {isUpdating ? <Spinner /> : <MoreHorizontalIcon />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={isUpdating}
            onClick={() => onHealthCheck(model)}
          >
            <RefreshCwIcon />
            检测
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={isUpdating} onClick={() => onEdit(model)}>
            <PencilIcon />
            编辑
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isUpdating} onClick={() => onCopy(model)}>
            <CopyIcon />
            复制
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={isUpdating || model.enabled}
            onClick={() => onStatusChange(model, true)}
          >
            <CheckIcon />
            启用
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isUpdating || !model.enabled}
            onClick={() => onStatusChange(model, false)}
          >
            <BanIcon />
            禁用
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={isUpdating || isFirst}
            onClick={() => onMove(model, "up")}
          >
            <ArrowUpIcon />
            上移
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isUpdating || isLast}
            onClick={() => onMove(model, "down")}
          >
            <ArrowDownIcon />
            下移
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={isUpdating}
            onClick={() => onDelete(model)}
            variant="destructive"
          >
            <Trash2Icon />
            删除
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LLMModelDialog({
  copyingModel,
  disabled,
  editingModel,
  onModelSaved,
  onOpenChange,
  open,
}: {
  copyingModel: LLMModel | null
  disabled: boolean
  editingModel: LLMModel | null
  onModelSaved: (model: LLMModel) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const displayNameId = useId()
  const modelNameId = useId()
  const baseUrlId = useId()
  const apiKeyId = useId()
  const [availableModels, setAvailableModels] = useState<DiscoveredLLMModel[]>(
    []
  )
  const [displayNameTouched, setDisplayNameTouched] = useState(false)
  const [form, setForm] = useState<LLMModelForm>(createDefaultLLMModelForm)
  const [isLoadingAvailableModels, setIsLoadingAvailableModels] =
    useState(false)
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isEditing = editingModel !== null
  const isModelDiscoveryDisabled =
    isSaving ||
    isLoadingAvailableModels ||
    form.baseUrl.trim() === "" ||
    form.apiKey.trim() === ""
  const isSubmitDisabled =
    disabled ||
    isSaving ||
    form.modelName.trim() === "" ||
    form.baseUrl.trim() === "" ||
    form.apiKey.trim() === ""

  useEffect(() => {
    if (!open) {
      setIsModelPickerOpen(false)
      setAvailableModels([])
      return
    }

    setForm(
      editingModel
        ? llmModelToForm(editingModel)
        : copyingModel
          ? llmModelToForm(copyingModel)
          : createDefaultLLMModelForm()
    )
    setDisplayNameTouched(editingModel !== null || copyingModel !== null)
    setIsModelPickerOpen(false)
    setAvailableModels([])
  }, [copyingModel, editingModel, open])

  function handleOpenChange(nextOpen: boolean) {
    if (isSaving) {
      return
    }

    onOpenChange(nextOpen)
  }

  function handleModelNameChange(value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      displayName: displayNameTouched ? currentForm.displayName : value,
      modelName: value,
    }))
  }

  function handleDisplayNameChange(value: string) {
    setDisplayNameTouched(true)
    setForm((currentForm) => ({
      ...currentForm,
      displayName: value,
    }))
  }

  async function loadAvailableModels() {
    if (isModelDiscoveryDisabled) {
      return
    }

    setIsModelPickerOpen(true)
    setIsLoadingAvailableModels(true)
    setAvailableModels([])

    try {
      const models = await discoverLLMModels({
        apiKey: form.apiKey,
        baseUrl: form.baseUrl,
      })
      setAvailableModels(models)
    } catch (error) {
      toast.error(
        error instanceof AdminAssistantRequestError
          ? error.message
          : "加载模型列表失败"
      )
    } finally {
      setIsLoadingAvailableModels(false)
    }
  }

  function handleAvailableModelSelect(model: DiscoveredLLMModel) {
    setForm((currentForm) => ({
      ...currentForm,
      displayName: model.id,
      modelName: model.id,
    }))
    setDisplayNameTouched(false)
    setIsModelPickerOpen(false)
  }

  function handleModelPickerOpenChange(nextOpen: boolean) {
    if (isLoadingAvailableModels) {
      return
    }

    setIsModelPickerOpen(nextOpen)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSubmitDisabled) {
      return
    }

    setIsSaving(true)

    try {
      const input = llmModelFormToInput(form)
      const model = editingModel
        ? await updateLLMModel(editingModel.id, input)
        : await createLLMModel(input)

      onModelSaved(model)
      toast.success("大模型已保存")
    } catch (error) {
      toast.error(
        error instanceof AdminAssistantRequestError
          ? error.message
          : "保存大模型失败"
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogTrigger
          render={
            <Button
              disabled={disabled}
              size="sm"
              type="button"
              variant="outline"
            />
          }
        >
          <PlusIcon data-icon="inline-start" />
          添加
        </DialogTrigger>
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!isSaving}
        >
          <DialogHeader>
            <DialogTitle>{isEditing ? "编辑大模型" : "添加大模型"}</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor={baseUrlId}>Base URL</FieldLabel>
                <Input
                  disabled={isSaving}
                  id={baseUrlId}
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      baseUrl: event.target.value,
                    }))
                  }
                  value={form.baseUrl}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={apiKeyId}>API Key</FieldLabel>
                <Input
                  disabled={isSaving}
                  id={apiKeyId}
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      apiKey: event.target.value,
                    }))
                  }
                  value={form.apiKey}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={modelNameId}>模型名称</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    disabled={isSaving}
                    id={modelNameId}
                    onChange={(event) =>
                      handleModelNameChange(event.target.value)
                    }
                    value={form.modelName}
                  />
                  <Button
                    aria-label="加载模型列表"
                    disabled={isModelDiscoveryDisabled}
                    onClick={loadAvailableModels}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    {isLoadingAvailableModels ? <Spinner /> : <RefreshCwIcon />}
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor={displayNameId}>显示名称</FieldLabel>
                <Input
                  disabled={isSaving}
                  id={displayNameId}
                  onChange={(event) =>
                    handleDisplayNameChange(event.target.value)
                  }
                  value={form.displayName}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                disabled={isSaving}
                onClick={() => handleOpenChange(false)}
                type="button"
                variant="ghost"
              >
                <XIcon data-icon="inline-start" />
                取消
              </Button>
              <Button disabled={isSubmitDisabled} type="submit">
                {isSaving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SaveIcon data-icon="inline-start" />
                )}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={handleModelPickerOpenChange}
        open={isModelPickerOpen}
      >
        <DialogContent
          className="max-h-[min(28rem,calc(100svh-2rem))] overflow-y-auto sm:max-w-md"
          showCloseButton={!isLoadingAvailableModels}
        >
          <DialogHeader>
            <DialogTitle>选择模型</DialogTitle>
          </DialogHeader>
          {isLoadingAvailableModels ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              正在加载模型
            </div>
          ) : availableModels.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无可选模型</div>
          ) : (
            <div className="flex flex-col gap-1">
              {availableModels.map((model) => (
                <Button
                  className="h-auto w-full flex-col items-start gap-1 px-3 py-2 text-left whitespace-normal"
                  key={model.id}
                  onClick={() => handleAvailableModelSelect(model)}
                  type="button"
                  variant="ghost"
                >
                  <span className="w-full truncate text-sm font-medium">
                    {model.id}
                  </span>
                  {model.displayName ? (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {model.displayName}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function createDefaultLLMModelForm(): LLMModelForm {
  return {
    apiKey: "",
    baseUrl: "",
    displayName: "",
    modelName: "",
  }
}

export function llmModelToForm(model: LLMModel): LLMModelForm {
  return {
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    displayName: model.displayName,
    modelName: model.modelName,
  }
}

export function llmModelFormToInput(form: LLMModelForm): LLMModelInput {
  return {
    apiKey: form.apiKey.trim(),
    baseUrl: form.baseUrl.trim(),
    displayName: form.displayName.trim(),
    modelName: form.modelName.trim(),
  }
}

export function sortLLMModelsForDisplay(models: LLMModel[]) {
  return [...models].sort((firstModel, secondModel) => {
    if (firstModel.sortOrder !== secondModel.sortOrder) {
      return firstModel.sortOrder - secondModel.sortOrder
    }

    const nameCompare = firstModel.displayName.localeCompare(
      secondModel.displayName
    )
    if (nameCompare !== 0) {
      return nameCompare
    }

    return firstModel.id.localeCompare(secondModel.id)
  })
}

export function getLLMModelRowClassName(enabled: boolean) {
  return enabled ? undefined : "text-muted-foreground"
}

export function getLLMModelColumnClassName(columnId: string) {
  if (columnId === "actions") {
    return "w-12"
  }

  return undefined
}

export function getLLMModelStatusBadgeClassName(
  status: LLMConnectivityStatus,
  enabled = true
) {
  if (!enabled) {
    return "shrink-0"
  }

  switch (status) {
    case "connected":
      return "shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
    case "failed":
      return "shrink-0 border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
    case "unknown":
      return "shrink-0 border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/60 dark:bg-yellow-950/40 dark:text-yellow-300"
  }
}

export function getLLMModelsTableContainerClassName() {
  return "overflow-hidden rounded-lg border bg-background"
}

export function getLLMModelsTableClassName() {
  return "[&_tr>*:first-child]:pl-4 [&_tr>*:last-child]:pr-4"
}

export function getLLMModelStatusBadgeText(model: LLMModel) {
  if (!model.enabled) {
    return "禁用"
  }

  switch (model.connectivityStatus) {
    case "connected":
      return formatLLMResponseDuration(model.lastResponseDurationMs)
    case "failed":
      return "异常"
    case "unknown":
      return "未检测"
  }
}

export function formatLLMResponseDuration(durationMS: null | number) {
  if (durationMS === null) {
    return "未检测"
  }

  return `${(durationMS / 1000).toFixed(1)}s`
}

export function getLLMConnectivityStatusText(status: LLMConnectivityStatus) {
  switch (status) {
    case "connected":
      return "可连接"
    case "failed":
      return "不可连接"
    case "unknown":
      return "未检测"
  }
}
