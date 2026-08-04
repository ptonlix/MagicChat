import { ClientDataRequestError } from "@/lib/client-api/core"

type DocumentDataFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type SuccessEnvelope<T> = { data?: T; success?: boolean }
type ErrorEnvelope = { error?: { code?: string; message?: string }; success?: boolean }

type DocumentUserResponse = {
  avatar?: unknown
  id?: unknown
  name?: unknown
  nickname?: unknown
}

type DocumentResponse = {
  created_at?: unknown
  creator?: unknown
  document_type?: unknown
  id?: unknown
  kind?: unknown
  parent_id?: unknown
  project_id?: unknown
  schema_version?: unknown
  sort_order?: unknown
  title?: unknown
  updated_at?: unknown
  updated_by?: unknown
}

export type ClientDocumentKind = "document" | "folder"
export type ClientDocumentUser = Readonly<{
  avatar: string
  id: string
  name: string
  nickname: string
}>
export type ClientDocument = Readonly<{
  createdAt: string
  creator: ClientDocumentUser
  documentType: "document" | null
  id: string
  kind: ClientDocumentKind
  parentId: string | null
  projectId: string
  schemaVersion: number
  sortOrder: number
  title: string
  updatedAt: string
  updatedBy: ClientDocumentUser
}>

export type CreateClientDocumentInput = Readonly<{
  kind: ClientDocumentKind
  parentId?: string | null
  title: string
}>
export type UpdateClientDocumentInput = Readonly<{
  parentId?: string | null
  sortOrder?: number
  title?: string
}>
export type MoveClientDocumentInput = Readonly<{ index: number; parentId: string | null }>

export async function listClientDocuments(
  projectId: string,
  fetcher: DocumentDataFetch = fetch,
  signal?: AbortSignal,
): Promise<ReadonlyArray<ClientDocument>> {
  const id = requireIdentifier(projectId, "项目")
  const payload = await request<{ documents?: unknown }>(
    `/api/client/projects/${encodeURIComponent(id)}/documents`,
    { credentials: "include", method: "GET", signal },
    "加载文档列表失败",
    fetcher,
  )
  if (!Array.isArray(payload.documents)) throw new ClientDataRequestError("文档列表响应格式不正确")
  const documents = payload.documents.map(normalizeDocument)
  const ids = new Set<string>()
  for (const document of documents) {
    if (document.projectId !== id) throw new ClientDataRequestError("文档不属于当前项目")
    if (ids.has(document.id)) throw new ClientDataRequestError("文档列表包含重复标识")
    ids.add(document.id)
  }
  return documents
}

export async function createClientDocument(
  projectId: string,
  input: CreateClientDocumentInput,
  fetcher: DocumentDataFetch = fetch,
  signal?: AbortSignal,
): Promise<ClientDocument> {
  return normalizeDocument(
    await request<DocumentResponse>(
      `/api/client/projects/${encodeURIComponent(requireIdentifier(projectId, "项目"))}/documents`,
      jsonRequest(
        "POST",
        { kind: input.kind, parent_id: input.parentId ?? null, title: input.title },
        signal,
      ),
      "创建文档失败",
      fetcher,
    ),
  )
}

export async function getClientDocument(
  documentId: string,
  fetcher: DocumentDataFetch = fetch,
  signal?: AbortSignal,
): Promise<ClientDocument> {
  return normalizeDocument(
    await request<DocumentResponse>(
      `/api/client/documents/${encodeURIComponent(requireIdentifier(documentId, "文档"))}`,
      { credentials: "include", method: "GET", signal },
      "加载文档失败",
      fetcher,
    ),
  )
}

export async function updateClientDocument(
  documentId: string,
  input: UpdateClientDocumentInput,
  fetcher: DocumentDataFetch = fetch,
  signal?: AbortSignal,
): Promise<ClientDocument> {
  const body: Record<string, unknown> = {}
  if (input.title !== undefined) body.title = input.title
  if (input.parentId !== undefined) body.parent_id = input.parentId
  if (input.sortOrder !== undefined) body.sort_order = input.sortOrder
  return normalizeDocument(
    await request<DocumentResponse>(
      `/api/client/documents/${encodeURIComponent(requireIdentifier(documentId, "文档"))}`,
      jsonRequest("PATCH", body, signal),
      "更新文档失败",
      fetcher,
    ),
  )
}

export async function moveClientDocument(
  documentId: string,
  input: MoveClientDocumentInput,
  fetcher: DocumentDataFetch = fetch,
  signal?: AbortSignal,
): Promise<ClientDocument> {
  return normalizeDocument(
    await request<DocumentResponse>(
      `/api/client/documents/${encodeURIComponent(requireIdentifier(documentId, "文档"))}/move`,
      jsonRequest("POST", { index: input.index, parent_id: input.parentId }, signal),
      "移动文档失败",
      fetcher,
    ),
  )
}

export async function updateCollaborativeDocumentTitle(
  documentId: string,
  title: string,
  fetcher: DocumentDataFetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const id = requireIdentifier(documentId, "文档")
  const data = await request<{ document_id?: unknown; title?: unknown }>(
    `/api/client/document/collaboration/${encodeURIComponent(id)}/title`,
    { ...jsonRequest("PATCH", { title }, signal), keepalive: !signal },
    "保存文档标题失败",
    fetcher,
  )
  if (data.document_id !== id || typeof data.title !== "string") {
    throw new ClientDataRequestError("文档标题响应格式不正确")
  }
  return data.title
}

export async function deleteClientDocument(
  documentId: string,
  fetcher: DocumentDataFetch = fetch,
  signal?: AbortSignal,
): Promise<Readonly<{ deletedCount: number; documentId: string }>> {
  const id = requireIdentifier(documentId, "文档")
  const data = await request<{ deleted_count?: unknown; document_id?: unknown }>(
    `/api/client/documents/${encodeURIComponent(id)}`,
    { credentials: "include", method: "DELETE", signal },
    "删除文档失败",
    fetcher,
  )
  if (
    data.document_id !== id ||
    !Number.isSafeInteger(data.deleted_count) ||
    (data.deleted_count as number) < 1
  ) {
    throw new ClientDataRequestError("删除文档响应格式不正确")
  }
  return { deletedCount: data.deleted_count as number, documentId: id }
}

function jsonRequest(method: "PATCH" | "POST", body: unknown, signal?: AbortSignal): RequestInit {
  return {
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method,
    signal,
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
  fetcher: DocumentDataFetch,
): Promise<T> {
  const response = await fetcher(path, init)
  const payload = await readJson<ErrorEnvelope | SuccessEnvelope<T>>(response)
  if (!response.ok || payload?.success === false) {
    const error = (payload as ErrorEnvelope | undefined)?.error
    throw new ClientDataRequestError(error?.message?.trim() || fallbackMessage, {
      code: typeof error?.code === "string" ? error.code : undefined,
      status: response.status,
    })
  }
  const data = (payload as SuccessEnvelope<T> | undefined)?.data
  if (data === undefined || data === null) {
    throw new ClientDataRequestError(`${fallbackMessage}：响应格式不正确`)
  }
  return data
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T
  } catch {
    return undefined
  }
}

function normalizeDocument(input: unknown): ClientDocument {
  if (!input || typeof input !== "object") throw new ClientDataRequestError("文档响应格式不正确")
  const value = input as DocumentResponse
  if (
    !isIdentifier(value.id) ||
    !isIdentifier(value.project_id) ||
    (value.kind !== "document" && value.kind !== "folder") ||
    typeof value.title !== "string" ||
    Array.from(value.title).length > 500 ||
    !isNonNegativeInteger(value.sort_order) ||
    !Number.isSafeInteger(value.schema_version) ||
    (value.schema_version as number) < 1 ||
    !isDateString(value.created_at) ||
    !isDateString(value.updated_at) ||
    (value.parent_id !== null && value.parent_id !== undefined && !isIdentifier(value.parent_id))
  ) {
    throw new ClientDataRequestError("文档响应格式不正确")
  }
  if (
    (value.kind === "document" && value.document_type !== "document") ||
    (value.kind === "folder" && value.document_type != null)
  ) {
    throw new ClientDataRequestError("文档类型响应格式不正确")
  }
  return Object.freeze({
    createdAt: value.created_at as string,
    creator: normalizeUser(value.creator),
    documentType: value.kind === "document" ? "document" : null,
    id: value.id as string,
    kind: value.kind,
    parentId: (value.parent_id as string | null | undefined) ?? null,
    projectId: value.project_id as string,
    schemaVersion: value.schema_version as number,
    sortOrder: value.sort_order as number,
    title: value.title,
    updatedAt: value.updated_at as string,
    updatedBy: normalizeUser(value.updated_by),
  })
}

function normalizeUser(input: unknown): ClientDocumentUser {
  if (!input || typeof input !== "object") {
    throw new ClientDataRequestError("文档用户响应格式不正确")
  }
  const value = input as DocumentUserResponse
  if (!isIdentifier(value.id) || typeof value.name !== "string" || value.name.length > 200) {
    throw new ClientDataRequestError("文档用户响应格式不正确")
  }
  return Object.freeze({
    avatar: typeof value.avatar === "string" ? value.avatar : "",
    id: value.id,
    name: value.name,
    nickname: typeof value.nickname === "string" ? value.nickname : "",
  })
}

function requireIdentifier(value: string, label: string): string {
  if (!isIdentifier(value)) throw new ClientDataRequestError(`${label}标识无效`)
  return value
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[\u0000-\u001f]/.test(value)
  )
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value))
}
