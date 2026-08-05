import { ClientDataRequestError, createRequestError, readJson } from "@/lib/client-api/core"
import type {
  ClientDataErrorEnvelope,
  ClientDataFetch,
  ClientDataSuccessEnvelope,
  TemporaryFileReadURL,
} from "@/lib/client-api/types"
import {
  invalidateTemporaryFileReadURLCache,
  readTemporaryFileURLs,
} from "@/lib/client-api/messages"

export const maximumDocumentImageBytes = 10 * 1024 * 1024
const allowedTypes = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"])
const maximumBatchSize = 100
const maximumFallbackConcurrency = 8

type UploadResponse = { file?: { id?: unknown; size_bytes?: unknown } }

export type UploadedDocumentImage = Readonly<{ fileId: string; sizeBytes: number }>

type SingleFileResolution =
  | { fileId: string; missing: true; urls: [] }
  | { fileId: string; missing: false; urls: TemporaryFileReadURL[] }

async function resolveDocumentImageBatchIndividually(
  fileIds: readonly string[],
  fetcher: ClientDataFetch,
): Promise<SingleFileResolution[]> {
  const results = new Map<string, SingleFileResolution>()
  let nextIndex = 0

  async function worker() {
    while (nextIndex < fileIds.length) {
      const index = nextIndex
      nextIndex += 1
      const fileId = fileIds[index]
      if (!fileId) continue

      try {
        results.set(fileId, {
          fileId,
          missing: false,
          urls: await readTemporaryFileURLs([fileId], fetcher),
        })
      } catch (error) {
        if (error instanceof ClientDataRequestError && error.status === 404) {
          results.set(fileId, { fileId, missing: true, urls: [] })
          continue
        }
        throw error
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maximumFallbackConcurrency, fileIds.length) }, () => worker()),
  )

  return fileIds.flatMap((fileId) => {
    const result = results.get(fileId)
    return result ? [result] : []
  })
}

export async function uploadDocumentImage(
  file: File,
  fetcher: ClientDataFetch = fetch,
  signal?: AbortSignal,
): Promise<UploadedDocumentImage> {
  if (!allowedTypes.has(file.type)) throw new Error("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片")
  if (file.size <= 0) throw new Error("图片内容为空")
  if (file.size > maximumDocumentImageBytes) throw new Error("图片不能超过 10 MiB")
  const body = new FormData()
  body.set("file", file)
  const response = await fetcher("/api/client/temporary-files", {
    body,
    credentials: "include",
    method: "POST",
    signal,
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<UploadResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "上传图片失败")
  }
  const uploaded = (payload as ClientDataSuccessEnvelope<UploadResponse> | undefined)?.data?.file
  if (
    typeof uploaded?.id !== "string" ||
    typeof uploaded.size_bytes !== "number" ||
    uploaded.size_bytes <= 0 ||
    uploaded.size_bytes > maximumDocumentImageBytes
  ) {
    throw new ClientDataRequestError("图片上传响应格式不正确")
  }
  return { fileId: uploaded.id, sizeBytes: uploaded.size_bytes }
}

export async function resolveDocumentImageURLs(
  fileIds: readonly string[],
  forceRefresh = false,
  fetcher: ClientDataFetch = fetch,
): Promise<Readonly<{ missingFileIds: string[]; urls: TemporaryFileReadURL[] }>> {
  const unique = [...new Set(fileIds.filter(Boolean))]
  if (forceRefresh) invalidateTemporaryFileReadURLCache(unique)
  const missingFileIds: string[] = []
  const urls: TemporaryFileReadURL[] = []
  for (let index = 0; index < unique.length; index += maximumBatchSize) {
    const batch = unique.slice(index, index + maximumBatchSize)
    try {
      urls.push(...(await readTemporaryFileURLs(batch, fetcher)))
    } catch (error) {
      if (!(error instanceof ClientDataRequestError) || error.status !== 404) throw error
      // 批量接口是全有或全无语义；回退时限制并发，避免一个失效文件拖成串行往返。
      const individualResults = await resolveDocumentImageBatchIndividually(batch, fetcher)
      for (const result of individualResults) {
        if (result.missing) missingFileIds.push(result.fileId)
        else urls.push(...result.urls)
      }
    }
  }
  const byId = new Map(urls.map((item) => [item.fileId, item]))
  return { missingFileIds, urls: unique.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) }
}
