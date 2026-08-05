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

type UploadResponse = { file?: { id?: unknown; size_bytes?: unknown } }

export type UploadedDocumentImage = Readonly<{ fileId: string; sizeBytes: number }>

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
      for (const fileId of batch) {
        try {
          urls.push(...(await readTemporaryFileURLs([fileId], fetcher)))
        } catch (fileError) {
          if (fileError instanceof ClientDataRequestError && fileError.status === 404) {
            missingFileIds.push(fileId)
          } else {
            throw fileError
          }
        }
      }
    }
  }
  const byId = new Map(urls.map((item) => [item.fileId, item]))
  return { missingFileIds, urls: unique.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) }
}
