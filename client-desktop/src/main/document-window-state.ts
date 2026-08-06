import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import {
  isValidDocumentWindowRectangle,
  type DocumentWindowRectangle,
} from "@main/document-window-bounds"

export type DocumentWindowPersistedState = Readonly<{
  bounds: DocumentWindowRectangle
  displayId?: number | string
}>

export interface DocumentWindowStateStore {
  get(key: string): DocumentWindowPersistedState | undefined
  set(key: string, state: DocumentWindowPersistedState): Promise<void>
  delete(key: string): Promise<void>
}

type StoredState = Record<string, DocumentWindowPersistedState>

export class FileDocumentWindowStateStore implements DocumentWindowStateStore {
  private readonly states = new Map<string, DocumentWindowPersistedState>()
  private readonly filePath: string
  private operationQueue = Promise.resolve()

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "document-window-state.json")
  }

  async load(): Promise<void> {
    await this.enqueue(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      const next: StoredState = {}
      try {
        const raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown
        if (!raw || typeof raw !== "object") throw new Error("窗口状态格式无效")
        for (const [key, value] of Object.entries(raw)) {
          const state = parseState(value)
          if (state && key.length <= 512) next[key] = state
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          await rename(this.filePath, `${this.filePath}.invalid-${Date.now()}`).catch(
            () => undefined,
          )
      }
      this.states.clear()
      for (const [key, state] of Object.entries(next)) this.states.set(key, state)
      await this.persist()
    })
  }

  get(key: string): DocumentWindowPersistedState | undefined {
    const state = this.states.get(key)
    return state ? structuredClone(state) : undefined
  }

  set(key: string, state: DocumentWindowPersistedState): Promise<void> {
    if (key.length === 0 || key.length > 512) throw new Error("窗口状态键无效")
    const parsed = parseState(state)
    if (!parsed) throw new Error("窗口状态无效")
    this.states.set(key, parsed)
    return this.enqueue(() => this.persist())
  }

  delete(key: string): Promise<void> {
    this.states.delete(key)
    return this.enqueue(() => this.persist())
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationQueue.then(operation)
    this.operationQueue = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const value = Object.fromEntries(this.states.entries())
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

function parseState(value: unknown): DocumentWindowPersistedState | undefined {
  if (!value || typeof value !== "object") return undefined
  const input = value as Record<string, unknown>
  if (!isValidDocumentWindowRectangle(input.bounds)) return undefined
  if (
    input.displayId !== undefined &&
    typeof input.displayId !== "string" &&
    typeof input.displayId !== "number"
  )
    return undefined
  return Object.freeze({
    bounds: Object.freeze({ ...input.bounds }),
    ...(input.displayId !== undefined ? { displayId: input.displayId } : {}),
  })
}
