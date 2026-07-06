import { adminFetch } from "@/lib/auth"

type AdminAssistantFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

type AdminAssistantSuccessEnvelope<T> = {
  data?: T
  success?: boolean
}

type AdminAssistantErrorEnvelope = {
  error?: {
    code?: string
    message?: string
  }
  success?: boolean
}

type LLMModelResponse = {
  api_key?: string
  base_url?: string
  connectivity_status?: string
  display_name?: string
  enabled?: boolean
  id?: string
  last_checked_at?: null | string
  last_connected_at?: null | string
  last_error_message?: string
  last_response_duration_ms?: null | number
  model_name?: string
  protocol?: string
  sort_order?: number
}

type DiscoveredLLMModelResponse = {
  display_name?: string
  id?: string
}

export type LLMConnectivityStatus = "connected" | "failed" | "unknown"

export type LLMModel = {
  apiKey: string
  baseUrl: string
  connectivityStatus: LLMConnectivityStatus
  displayName: string
  enabled: boolean
  id: string
  lastCheckedAt: null | string
  lastConnectedAt: null | string
  lastErrorMessage: string
  lastResponseDurationMs: null | number
  modelName: string
  protocol: "anthropic"
  sortOrder: number
}

export type LLMModelInput = Pick<
  LLMModel,
  "apiKey" | "baseUrl" | "displayName" | "modelName"
>

export type LLMModelMoveDirection = "down" | "up"

export type DiscoverLLMModelsInput = Pick<LLMModel, "apiKey" | "baseUrl">

export type DiscoveredLLMModel = {
  displayName: string
  id: string
}

export class AdminAssistantRequestError extends Error {
  code?: string

  constructor(message: string, options?: { code?: string }) {
    super(message)
    this.name = "AdminAssistantRequestError"
    this.code = options?.code
  }
}

export async function listLLMModels(fetcher: AdminAssistantFetch = adminFetch) {
  const response = await fetcher("/api/admin/assistant/models", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    | AdminAssistantErrorEnvelope
    | AdminAssistantSuccessEnvelope<{ models?: LLMModelResponse[] }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载大模型失败")
  }

  const models = (
    payload as
      | AdminAssistantSuccessEnvelope<{ models?: LLMModelResponse[] }>
      | undefined
  )?.data?.models

  return normalizeLLMModelList(models)
}

export async function createLLMModel(
  input: LLMModelInput,
  fetcher: AdminAssistantFetch = adminFetch
) {
  return saveLLMModel("/api/admin/assistant/models", "POST", input, fetcher)
}

export async function discoverLLMModels(
  input: DiscoverLLMModelsInput,
  fetcher: AdminAssistantFetch = adminFetch
) {
  const response = await fetcher("/api/admin/assistant/models/discover", {
    body: JSON.stringify({
      base_url: input.baseUrl.trim(),
      api_key: input.apiKey.trim(),
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = await readJson<
    | AdminAssistantErrorEnvelope
    | AdminAssistantSuccessEnvelope<{ models?: DiscoveredLLMModelResponse[] }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载模型列表失败")
  }

  const models = (
    payload as
      | AdminAssistantSuccessEnvelope<{
          models?: DiscoveredLLMModelResponse[]
        }>
      | undefined
  )?.data?.models

  return normalizeDiscoveredLLMModelList(models)
}

export async function updateLLMModel(
  id: string,
  input: LLMModelInput,
  fetcher: AdminAssistantFetch = adminFetch
) {
  return saveLLMModel(
    `/api/admin/assistant/models/${encodeURIComponent(id)}`,
    "PUT",
    input,
    fetcher
  )
}

export async function deleteLLMModel(
  id: string,
  fetcher: AdminAssistantFetch = adminFetch
) {
  const response = await fetcher(
    `/api/admin/assistant/models/${encodeURIComponent(id)}`,
    {
      credentials: "include",
      method: "DELETE",
    }
  )
  const payload = await readJson<
    | AdminAssistantErrorEnvelope
    | AdminAssistantSuccessEnvelope<Record<string, never>>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "删除大模型失败")
  }
}

export async function enableLLMModel(
  id: string,
  fetcher: AdminAssistantFetch = adminFetch
) {
  return updateLLMModelStatus(id, "enable", fetcher)
}

export async function disableLLMModel(
  id: string,
  fetcher: AdminAssistantFetch = adminFetch
) {
  return updateLLMModelStatus(id, "disable", fetcher)
}

export async function moveLLMModel(
  id: string,
  direction: LLMModelMoveDirection,
  fetcher: AdminAssistantFetch = adminFetch
) {
  const response = await fetcher(
    `/api/admin/assistant/models/${encodeURIComponent(id)}/move`,
    {
      body: JSON.stringify({
        direction,
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  )
  const payload = await readJson<
    | AdminAssistantErrorEnvelope
    | AdminAssistantSuccessEnvelope<{ models?: LLMModelResponse[] }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "移动大模型失败")
  }

  const models = (
    payload as
      | AdminAssistantSuccessEnvelope<{ models?: LLMModelResponse[] }>
      | undefined
  )?.data?.models

  return normalizeLLMModelList(models)
}

export async function checkLLMModelHealth(
  id: string,
  fetcher: AdminAssistantFetch = adminFetch
) {
  const startedAt = Date.now()
  const response = await fetcher(
    `/api/admin/assistant/models/${encodeURIComponent(id)}/health-check`,
    {
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    | AdminAssistantErrorEnvelope
    | AdminAssistantSuccessEnvelope<{ model?: LLMModelResponse }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "检测大模型失败")
  }

  const model = (
    payload as
      | AdminAssistantSuccessEnvelope<{ model?: LLMModelResponse }>
      | undefined
  )?.data?.model

  const normalizedModel = normalizeLLMModel(model)
  if (
    normalizedModel.connectivityStatus === "connected" &&
    normalizedModel.lastResponseDurationMs === null
  ) {
    return {
      ...normalizedModel,
      lastResponseDurationMs: Math.max(1, Date.now() - startedAt),
    }
  }

  return normalizedModel
}

async function saveLLMModel(
  path: string,
  method: "POST" | "PUT",
  input: LLMModelInput,
  fetcher: AdminAssistantFetch
) {
  const response = await fetcher(path, {
    body: JSON.stringify(toLLMModelRequest(input)),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method,
  })
  const payload = await readJson<
    | AdminAssistantErrorEnvelope
    | AdminAssistantSuccessEnvelope<{ model?: LLMModelResponse }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "保存大模型失败")
  }

  const model = (
    payload as
      | AdminAssistantSuccessEnvelope<{ model?: LLMModelResponse }>
      | undefined
  )?.data?.model

  return normalizeLLMModel(model)
}

async function updateLLMModelStatus(
  id: string,
  operation: "disable" | "enable",
  fetcher: AdminAssistantFetch
) {
  const response = await fetcher(
    `/api/admin/assistant/models/${encodeURIComponent(id)}/${operation}`,
    {
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    | AdminAssistantErrorEnvelope
    | AdminAssistantSuccessEnvelope<{ model?: LLMModelResponse }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "更新大模型状态失败")
  }

  const model = (
    payload as
      | AdminAssistantSuccessEnvelope<{ model?: LLMModelResponse }>
      | undefined
  )?.data?.model

  return normalizeLLMModel(model)
}

function normalizeLLMModelList(
  models: LLMModelResponse[] | undefined
): LLMModel[] {
  if (!Array.isArray(models)) {
    throw new AdminAssistantRequestError("大模型列表响应格式不正确")
  }

  return models.map(normalizeLLMModel)
}

function normalizeDiscoveredLLMModelList(
  models: DiscoveredLLMModelResponse[] | undefined
): DiscoveredLLMModel[] {
  if (!Array.isArray(models)) {
    throw new AdminAssistantRequestError("模型列表响应格式不正确")
  }

  return models.map(normalizeDiscoveredLLMModel)
}

function normalizeDiscoveredLLMModel(
  model: DiscoveredLLMModelResponse
): DiscoveredLLMModel {
  if (!model || typeof model.id !== "string") {
    throw new AdminAssistantRequestError("模型响应格式不正确")
  }
  if (
    model.display_name !== undefined &&
    typeof model.display_name !== "string"
  ) {
    throw new AdminAssistantRequestError("模型显示名称响应格式不正确")
  }

  return {
    displayName: model.display_name || "",
    id: model.id,
  }
}

function normalizeLLMModel(model: LLMModelResponse | undefined): LLMModel {
  if (
    !model ||
    typeof model.api_key !== "string" ||
    typeof model.base_url !== "string" ||
    typeof model.connectivity_status !== "string" ||
    typeof model.display_name !== "string" ||
    typeof model.enabled !== "boolean" ||
    typeof model.id !== "string" ||
    typeof model.last_error_message !== "string" ||
    typeof model.model_name !== "string" ||
    typeof model.protocol !== "string" ||
    typeof model.sort_order !== "number"
  ) {
    throw new AdminAssistantRequestError("大模型响应格式不正确")
  }
  if (!isLLMConnectivityStatus(model.connectivity_status)) {
    throw new AdminAssistantRequestError("大模型连接状态响应格式不正确")
  }
  if (model.protocol !== "anthropic") {
    throw new AdminAssistantRequestError("大模型协议响应格式不正确")
  }

  return {
    apiKey: model.api_key,
    baseUrl: model.base_url,
    connectivityStatus: model.connectivity_status,
    displayName: model.display_name,
    enabled: model.enabled,
    id: model.id,
    lastCheckedAt: normalizeNullableDate(model.last_checked_at),
    lastConnectedAt: normalizeNullableDate(model.last_connected_at),
    lastErrorMessage: model.last_error_message,
    lastResponseDurationMs: normalizeNullableNumber(
      model.last_response_duration_ms
    ),
    modelName: model.model_name,
    protocol: model.protocol,
    sortOrder: model.sort_order,
  }
}

function normalizeNullableDate(value: null | string | undefined) {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "string") {
    throw new AdminAssistantRequestError("大模型时间响应格式不正确")
  }

  return value
}

function normalizeNullableNumber(value: null | number | undefined) {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "number") {
    throw new AdminAssistantRequestError("大模型响应时间响应格式不正确")
  }

  return value
}

function isLLMConnectivityStatus(
  value: string
): value is LLMConnectivityStatus {
  return value === "unknown" || value === "connected" || value === "failed"
}

function toLLMModelRequest(input: LLMModelInput) {
  return {
    display_name: input.displayName.trim(),
    model_name: input.modelName.trim(),
    base_url: input.baseUrl.trim(),
    api_key: input.apiKey.trim(),
  }
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text()
  if (!text) {
    return undefined
  }

  return JSON.parse(text) as T
}

function createRequestError(
  payload:
    | AdminAssistantErrorEnvelope
    | AdminAssistantSuccessEnvelope<unknown>
    | undefined,
  response: Response,
  fallbackMessage: string
) {
  const errorPayload = payload as AdminAssistantErrorEnvelope | undefined
  return new AdminAssistantRequestError(
    errorPayload?.error?.message || fallbackMessage,
    {
      code: errorPayload?.error?.code || `http_${response.status}`,
    }
  )
}
