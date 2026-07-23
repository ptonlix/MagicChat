import { randomUUID } from "node:crypto"
import { PassThrough, Readable } from "node:stream"
import { assertClientPath, type AuthenticatedTarget, type ClientRequest, type ClientResponse } from "../shared/client-contract"
import type { ServerProfiles } from "./server-profiles"
import type { SessionController } from "./session-controller"

const MAX_CHUNK_BYTES = 256 * 1024
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

type Upload = {
  abort: AbortController
  bytes: number
  ownerId: number
  requestId: string
  response: Promise<Response>
  serverId: string
  stream: PassThrough
}

export class StreamingUploadController {
  private readonly uploads = new Map<string, Upload>()

  constructor(private readonly profiles: ServerProfiles, private readonly sessions: SessionController) {}

  start(ownerId: number, target: AuthenticatedTarget, request: Pick<ClientRequest, "headers" | "method" | "path" | "requestId">): string {
    if (!(["PATCH", "POST", "PUT"] as const).includes(request.method as "PATCH" | "POST" | "PUT")) throw new Error("流式上传方法无效")
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)) throw new Error("请求标识无效")
    const profile = this.profiles.require(target.id)
    if (profile.normalizedUrl !== target.normalizedUrl) throw new Error("认证目标无效")
    const contentType = request.headers?.["content-type"] ?? request.headers?.["Content-Type"] ?? ""
    if (!contentType.startsWith("multipart/form-data; boundary=") || /[\r\n]/.test(contentType)) throw new Error("流式上传 Content-Type 无效")
    const stream = new PassThrough({ highWaterMark: MAX_CHUNK_BYTES })
    const abort = new AbortController()
    const response = this.sessions.for(profile).fetch(`${profile.normalizedUrl}${assertClientPath(request.path)}`, {
      body: Readable.toWeb(stream) as ReadableStream,
      credentials: "include",
      duplex: "half",
      headers: { Accept: "application/json", "Content-Type": contentType },
      method: request.method,
      signal: abort.signal,
    } as RequestInit)
    const id = randomUUID()
    this.uploads.set(id, { abort, bytes: 0, ownerId, requestId: request.requestId, response, serverId: profile.id, stream })
    return id
  }

  async chunk(ownerId: number, streamId: string, rawChunk: Uint8Array): Promise<void> {
    const upload = this.require(ownerId, streamId)
    const chunk = Uint8Array.from(rawChunk)
    if (chunk.byteLength === 0 || chunk.byteLength > MAX_CHUNK_BYTES) throw new Error("上传分块大小无效")
    upload.bytes += chunk.byteLength
    if (upload.bytes > MAX_UPLOAD_BYTES) { this.abort(ownerId, streamId); throw new Error("上传文件超过 5 GiB 限制") }
    if (!upload.stream.write(Buffer.from(chunk))) await new Promise<void>((resolve, reject) => {
      upload.stream.once("drain", resolve)
      upload.stream.once("error", reject)
    })
  }

  async finish(ownerId: number, streamId: string): Promise<ClientResponse> {
    const upload = this.require(ownerId, streamId)
    upload.stream.end()
    try {
      const response = await upload.response
      const declared = Number(response.headers.get("content-length") ?? 0)
      if (declared > MAX_RESPONSE_BYTES) throw new Error("上传响应过大")
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("上传响应过大")
      const contentType = response.headers.get("content-type") ?? ""
      const text = new TextDecoder().decode(bytes)
      return { body: contentType.includes("application/json") ? JSON.parse(text || "null") : text, headers: { "content-type": contentType }, status: response.status }
    } finally { this.uploads.delete(streamId) }
  }

  abort(ownerId: number, streamId: string): void {
    const upload = this.require(ownerId, streamId)
    upload.abort.abort()
    upload.stream.destroy(new Error("上传已取消"))
    void upload.response.catch(() => undefined)
    this.uploads.delete(streamId)
  }

  releaseOwner(ownerId: number): void {
    for (const [id, upload] of this.uploads) if (upload.ownerId === ownerId) this.abort(ownerId, id)
  }

  cleanupServer(serverId: string): void {
    for (const [id, upload] of this.uploads) if (upload.serverId === serverId) this.abort(upload.ownerId, id)
  }

  hasActiveTransfers(): boolean { return this.uploads.size > 0 }

  private require(ownerId: number, streamId: string): Upload {
    if (!/^[a-f0-9-]{36}$/.test(streamId)) throw new Error("上传流标识无效")
    const upload = this.uploads.get(streamId)
    if (!upload || upload.ownerId !== ownerId) throw new Error("上传流不存在或不属于当前窗口")
    return upload
  }
}
