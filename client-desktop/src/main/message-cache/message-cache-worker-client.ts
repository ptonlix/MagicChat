import { Worker } from "node:worker_threads"
import { MessageCacheError, type MessageCacheErrorCode } from "@shared/message-cache-contract"
import type {
  MessageCacheWorkerOperation,
  MessageCacheWorkerRequest,
  MessageCacheWorkerResponse,
} from "./message-cache-protocol"

const maximumQueueSize = 128
const requestTimeoutMs = 10_000

type PendingRequest = {
  reject(error: unknown): void
  resolve(value: unknown): void
  timeout: NodeJS.Timeout
}

export class MessageCacheWorkerClient {
  private readonly pending = new Map<number, PendingRequest>()
  private accepting = true
  private nextId = 1
  private worker: Worker | null
  private recoveryAttempts = 0
  private recoveryPromise: Promise<void> | null = null

  constructor(
    private readonly workerPath: string,
    private readonly databasePath: string,
  ) {
    this.worker = this.createWorker()
  }

  recover(): Promise<void> {
    if (this.worker) return Promise.resolve()
    if (this.recoveryPromise) return this.recoveryPromise
    const delay = Math.min(60_000, 1_000 * 2 ** this.recoveryAttempts)
    this.recoveryAttempts += 1
    this.recoveryPromise = new Promise((resolve) => setTimeout(resolve, delay))
      .then(() => {
        if (!this.accepting || this.worker) return
        this.worker = this.createWorker()
      })
      .finally(() => {
        this.recoveryPromise = null
      })
    return this.recoveryPromise
  }

  reopen(): Promise<void> {
    if (this.accepting && this.worker) return Promise.resolve()
    this.accepting = true
    this.recoveryAttempts = 0
    if (!this.worker) this.worker = this.createWorker()
    return Promise.resolve()
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerPath, { workerData: { databasePath: this.databasePath } })
    worker.on("message", (response: MessageCacheWorkerResponse) => {
      this.recoveryAttempts = 0
      this.receive(response)
    })
    worker.on("error", () => this.failAll("cache_worker_failed"))
    worker.on("exit", (code) => {
      if (code !== 0) this.failAll("cache_worker_failed")
      if (this.worker === worker) this.worker = null
    })
    return worker
  }

  request<T>(operation: MessageCacheWorkerOperation): Promise<T> {
    if (!this.accepting || !this.worker) {
      return Promise.reject(new MessageCacheError("cache_closed"))
    }
    if (this.pending.size >= maximumQueueSize) {
      return Promise.reject(new MessageCacheError("cache_busy"))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new MessageCacheError("cache_timeout"))
      }, requestTimeoutMs)
      this.pending.set(id, {
        reject,
        resolve: (value) => resolve(value as T),
        timeout,
      })
      const request: MessageCacheWorkerRequest = { id, operation }
      this.worker?.postMessage(request)
    })
  }

  async close(): Promise<void> {
    if (!this.accepting) return
    this.accepting = false
    const worker = this.worker
    if (!worker) return
    try {
      await this.requestWhileClosing({ kind: "shutdown" })
    } finally {
      await worker.terminate()
      this.worker = null
      this.failAll("cache_closed")
    }
  }

  private requestWhileClosing(operation: MessageCacheWorkerOperation): Promise<unknown> {
    this.accepting = true
    const result = this.request(operation)
    this.accepting = false
    return result
  }

  private receive(response: MessageCacheWorkerResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    clearTimeout(pending.timeout)
    if (response.errorCode) {
      pending.reject(new MessageCacheError(response.errorCode as MessageCacheErrorCode))
    } else {
      pending.resolve(response.result)
    }
  }

  private failAll(code: MessageCacheErrorCode): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new MessageCacheError(code))
    }
    this.pending.clear()
  }
}
