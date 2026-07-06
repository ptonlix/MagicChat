import { describe, expect, it } from "vitest"

import assistantPageSourceText from "./assistant-page.tsx?raw"
import {
  createDefaultLLMModelForm,
  getLLMModelColumnClassName,
  getLLMModelRowClassName,
  getLLMModelStatusBadgeClassName,
  getLLMModelStatusBadgeText,
  getLLMConnectivityStatusText,
  getLLMModelsTableClassName,
  getLLMModelsTableContainerClassName,
  formatLLMResponseDuration,
  llmModelFormToInput,
  llmModelToForm,
  sortLLMModelsForDisplay,
} from "@/pages/assistant-page"

describe("assistant page LLM model form", () => {
  it("uses empty defaults for new models", () => {
    expect(createDefaultLLMModelForm()).toEqual({
      apiKey: "",
      baseUrl: "",
      displayName: "",
      modelName: "",
    })
  })

  it("converts models to editable form state", () => {
    expect(
      llmModelToForm({
        apiKey: "sk-ant-test",
        baseUrl: "https://api.anthropic.com",
        connectivityStatus: "connected",
        displayName: "Claude Sonnet",
        enabled: true,
        id: "model-1",
        lastCheckedAt: "2026-07-06T11:30:00Z",
        lastConnectedAt: "2026-07-06T11:30:00Z",
        lastErrorMessage: "",
        lastResponseDurationMs: 1340,
        modelName: "claude-3-5-sonnet-latest",
        protocol: "anthropic",
        sortOrder: 10,
      })
    ).toEqual({
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
      displayName: "Claude Sonnet",
      modelName: "claude-3-5-sonnet-latest",
    })
  })

  it("converts form state to a trimmed API input", () => {
    expect(
      llmModelFormToInput({
        apiKey: " sk-ant-test ",
        baseUrl: " https://api.anthropic.com ",
        displayName: " Claude Sonnet ",
        modelName: " claude-3-5-sonnet-latest ",
      })
    ).toEqual({
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
      displayName: "Claude Sonnet",
      modelName: "claude-3-5-sonnet-latest",
    })
  })

  it("allows display name to be empty when converting form state", () => {
    expect(
      llmModelFormToInput({
        apiKey: " sk-ant-test ",
        baseUrl: " https://api.anthropic.com ",
        displayName: " ",
        modelName: " claude-3-5-sonnet-latest ",
      })
    ).toEqual({
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
      displayName: "",
      modelName: "claude-3-5-sonnet-latest",
    })
  })

  it("sorts models by sort order and display name", () => {
    const models = [
      createModel({ displayName: "Beta", id: "model-b", sortOrder: 2 }),
      createModel({ displayName: "Alpha", id: "model-c", sortOrder: 1 }),
      createModel({ displayName: "Gamma", id: "model-a", sortOrder: 1 }),
    ]

    expect(sortLLMModelsForDisplay(models).map((model) => model.id)).toEqual([
      "model-c",
      "model-a",
      "model-b",
    ])
    expect(models.map((model) => model.id)).toEqual([
      "model-b",
      "model-c",
      "model-a",
    ])
  })

  it("formats connectivity and disabled state for display", () => {
    expect(getLLMConnectivityStatusText("unknown")).toBe("未检测")
    expect(getLLMConnectivityStatusText("connected")).toBe("可连接")
    expect(getLLMConnectivityStatusText("failed")).toBe("不可连接")
    expect(getLLMModelStatusBadgeText(createModel({}))).toBe("未检测")
    expect(
      getLLMModelStatusBadgeText(
        createModel({
          connectivityStatus: "connected",
          lastResponseDurationMs: 1340,
        })
      )
    ).toBe("1.3s")
    expect(
      getLLMModelStatusBadgeText(
        createModel({
          connectivityStatus: "connected",
          lastResponseDurationMs: null,
        })
      )
    ).toBe("未检测")
    expect(
      getLLMModelStatusBadgeText(createModel({ connectivityStatus: "failed" }))
    ).toBe("异常")
    expect(
      getLLMModelStatusBadgeText(
        createModel({
          connectivityStatus: "connected",
          enabled: false,
          lastResponseDurationMs: 1340,
        })
      )
    ).toBe("禁用")
    expect(formatLLMResponseDuration(1340)).toBe("1.3s")
    expect(formatLLMResponseDuration(null)).toBe("未检测")
    expect(getLLMModelRowClassName(true)).toBeUndefined()
    expect(getLLMModelRowClassName(false)).toContain("text-muted-foreground")
    expect(getLLMModelColumnClassName("actions")).toBe("w-12")
    expect(getLLMModelColumnClassName("baseUrl")).toBeUndefined()
    expect(getLLMModelColumnClassName("status")).toBeUndefined()
    expect(getLLMModelStatusBadgeClassName("connected")).toContain(
      "bg-emerald-50"
    )
    expect(getLLMModelStatusBadgeClassName("connected")).toContain(
      "text-emerald-700"
    )
    expect(getLLMModelStatusBadgeClassName("failed")).toContain("bg-red-50")
    expect(getLLMModelStatusBadgeClassName("failed")).toContain("text-red-700")
    expect(getLLMModelStatusBadgeClassName("unknown")).toContain("bg-yellow-50")
    expect(getLLMModelStatusBadgeClassName("unknown")).toContain(
      "text-yellow-700"
    )
    expect(getLLMModelStatusBadgeClassName("connected", false)).toBe("shrink-0")
    expect(getLLMModelsTableContainerClassName()).toBe(
      "overflow-hidden rounded-lg border bg-background"
    )
    expect(getLLMModelsTableClassName()).toBe(
      "[&_tr>*:first-child]:pl-4 [&_tr>*:last-child]:pr-4"
    )
  })
})

describe("assistant page layout", () => {
  it("contains the LLM model management card and dialog", () => {
    expect(assistantPageSourceText).toContain("大模型")
    expect(assistantPageSourceText).toContain("暂无大模型")
    expect(assistantPageSourceText).toContain("LLMModelDialog")
    expect(assistantPageSourceText).toContain("添加")
    expect(assistantPageSourceText).toContain("复制")
    expect(assistantPageSourceText).toContain("检测")
    expect(assistantPageSourceText).not.toContain("立即检测")
  })

  it("copies a model by opening the add dialog with the current row values", () => {
    const actionsSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelActions(",
      "function LLMModelDialog("
    )
    const dialogSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelDialog(",
      "export function createDefaultLLMModelForm()"
    )

    expect(assistantPageSourceText).toContain("function openCopyForm(")
    expect(actionsSource).toContain("onCopy(model)")
    expect(dialogSource).toMatch(
      /copyingModel\s*\?\s*llmModelToForm\(copyingModel\)/
    )
    expect(dialogSource).toContain("await createLLMModel(input)")
  })

  it("lets the model card span the full page width", () => {
    expect(assistantPageSourceText).not.toContain("lg:grid-cols-2")
    expect(assistantPageSourceText).toContain(
      'className="grid min-w-0 flex-1 items-start gap-4 p-4 pt-0"'
    )
  })

  it("renders added models as a table list instead of per-model cards", () => {
    const pageSource = getSourceBetween(
      assistantPageSourceText,
      "return (",
      "function LLMModelStatusBadge("
    )

    expect(pageSource).toContain("<Table")
    expect(pageSource).toContain("<TableHeader>")
    expect(pageSource).toContain("<TableBody>")
    expect(pageSource).toContain("<TableRow")
    expect(pageSource).toContain("<TableCell")
    expect(pageSource).toContain("显示名称")
    expect(pageSource).toContain("模型名称")
    expect(pageSource).toContain("Base URL")
    expect(pageSource).toContain("状态")
    expect(pageSource).toContain("操作")
    expect(pageSource).toContain("LLMModelStatusBadge")
    expect(pageSource).not.toContain("上次检测")
    expect(pageSource).not.toContain("上次连接成功")
    expect(pageSource).not.toContain("rounded-md border px-3 py-2")
    expect(pageSource).not.toContain("flex flex-col gap-2")

    const statusBadgeSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelStatusBadge(",
      "function LLMModelActions("
    )
    expect(statusBadgeSource).toContain("<Tooltip")
    expect(statusBadgeSource).toContain("model.lastErrorMessage")
    expect(statusBadgeSource).toContain("break-all")
  })

  it("keeps enabled state in the status column", () => {
    const pageSource = getSourceBetween(
      assistantPageSourceText,
      "return (",
      "function LLMModelStatusBadge("
    )
    const rowSource = getSourceBetween(
      pageSource,
      "models.map((model, index) => (",
      "<LLMModelActions"
    )
    const displayNameCellSource = getSourceBetween(
      rowSource,
      'className={getLLMModelColumnClassName("displayName")}',
      'className={getLLMModelColumnClassName("modelName")}'
    )
    const statusCellSource = getSourceBetween(
      rowSource,
      'className={getLLMModelColumnClassName("status")}',
      'className={getLLMModelColumnClassName("actions")}'
    )

    expect(displayNameCellSource).not.toContain("model.enabled ?")
    expect(displayNameCellSource).not.toContain("<CheckIcon")
    expect(displayNameCellSource).not.toContain("CircleCheckIcon")
    expect(displayNameCellSource).not.toContain("BanIcon")
    expect(statusCellSource).toContain("LLMModelStatusBadge")
  })

  it("confirms model deletion with an alert dialog", () => {
    const pageSource = getSourceBetween(
      assistantPageSourceText,
      "return (",
      "function LLMModelStatusBadge("
    )

    expect(assistantPageSourceText).toContain("AlertDialog")
    expect(assistantPageSourceText).toContain("deleteConfirmationModel")
    expect(assistantPageSourceText).toContain("handleConfirmModelDelete")
    expect(pageSource).toContain("<AlertDialog")
    expect(pageSource).toContain("<AlertDialogTitle>")
    expect(pageSource).toContain("确认删除大模型")
    expect(pageSource).toContain("<AlertDialogDescription>")
    expect(pageSource).toContain("<AlertDialogCancel")
    expect(pageSource).toContain("<AlertDialogAction")
  })

  it("uses icons for every model action menu item", () => {
    const actionsSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelActions(",
      "function LLMModelDialog("
    )

    expect(actionsSource).toContain("RefreshCwIcon")
    expect(actionsSource).toContain("PencilIcon")
    expect(actionsSource).toContain("CopyIcon")
    expect(actionsSource).toContain("<CheckIcon")
    expect(actionsSource).not.toContain("CircleCheckIcon")
    expect(actionsSource).toContain("BanIcon")
    expect(actionsSource).toContain("ArrowUpIcon")
    expect(actionsSource).toContain("ArrowDownIcon")
    expect(actionsSource).toContain("Trash2Icon")
  })

  it("groups model action menu items with separators", () => {
    const actionsSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelActions(",
      "function LLMModelDialog("
    )

    expect(
      actionsSource.match(/<DropdownMenuGroup>/g)?.length ?? 0
    ).toBeGreaterThan(1)
    expect(actionsSource).toContain("DropdownMenuSeparator")
  })

  it("keeps generated fields and health state out of the model dialog", () => {
    const dialogSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelDialog(",
      "export function createDefaultLLMModelForm()"
    )

    expect(dialogSource).not.toContain(">启用<")
    expect(dialogSource).not.toContain(">排序<")
    expect(dialogSource).not.toContain(">连接状态<")
    expect(dialogSource).toContain("显示名称")
    expect(dialogSource).toContain("模型名称")
    expect(dialogSource).toContain("Base URL")
    expect(dialogSource).toContain("API Key")
  })

  it("orders the model dialog fields and supports discovering model names", () => {
    const dialogSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelDialog(",
      "export function createDefaultLLMModelForm()"
    )

    expect(dialogSource.indexOf("Base URL")).toBeLessThan(
      dialogSource.indexOf("API Key")
    )
    expect(dialogSource.indexOf("API Key")).toBeLessThan(
      dialogSource.indexOf("模型名称")
    )
    expect(dialogSource.indexOf("模型名称")).toBeLessThan(
      dialogSource.indexOf("显示名称")
    )
    expect(dialogSource).toContain("discoverLLMModels")
    expect(dialogSource).toContain("loadAvailableModels")
    expect(dialogSource).toContain("选择模型")
  })

  it("syncs display name when selecting a model from the discovered model list", () => {
    const dialogSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelDialog(",
      "export function createDefaultLLMModelForm()"
    )
    const selectSource = getSourceBetween(
      dialogSource,
      "function handleAvailableModelSelect(",
      "function handleModelPickerOpenChange("
    )

    expect(selectSource).toContain("displayName: model.id")
    expect(selectSource).not.toContain("displayNameTouched ?")
  })

  it("does not require display name before saving a model", () => {
    const dialogSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelDialog(",
      "export function createDefaultLLMModelForm()"
    )

    expect(dialogSource).not.toContain('form.displayName.trim() === ""')
    expect(dialogSource).toContain("setDisplayNameTouched")
  })

  it("keeps the model picker dialog compact with internal scrolling", () => {
    const dialogSource = getSourceBetween(
      assistantPageSourceText,
      "function LLMModelDialog(",
      "export function createDefaultLLMModelForm()"
    )
    const pickerSource = getSourceBetween(
      dialogSource,
      "open={isModelPickerOpen}",
      "<DialogTitle>选择模型</DialogTitle>"
    )

    expect(pickerSource).toContain(
      "max-h-[min(28rem,calc(100svh-2rem))] overflow-y-auto"
    )
  })
})

function getSourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Could not find source section between ${start} and ${end}`)
  }

  return source.slice(startIndex, endIndex)
}

function createModel({
  connectivityStatus = "unknown",
  displayName,
  enabled = true,
  id,
  lastResponseDurationMs = null,
  sortOrder,
}: {
  connectivityStatus?: "connected" | "failed" | "unknown"
  displayName?: string
  enabled?: boolean
  id?: string
  lastResponseDurationMs?: null | number
  sortOrder?: number
}) {
  return {
    apiKey: "sk-ant-test",
    baseUrl: "https://api.anthropic.com",
    connectivityStatus,
    displayName: displayName ?? "Claude Test",
    enabled,
    id: id ?? "model-test",
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastErrorMessage: "",
    lastResponseDurationMs,
    modelName: "claude-test",
    protocol: "anthropic" as const,
    sortOrder: sortOrder ?? 10,
  }
}
