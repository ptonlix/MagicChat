export type DocumentTitleSaveState = "failed" | "pending" | "saved" | "saving"
export type DocumentTitleSnapshot = Readonly<{
  authoritativeTitle: string
  input: string
  state: DocumentTitleSaveState
}>

type Listener = (snapshot: DocumentTitleSnapshot) => void

export class DocumentTitleController {
  private authoritativeTitle: string
  private destroyed = false
  private input: string
  private listener?: Listener
  private pendingAfterSave = false
  private remoteTitle?: string
  private saving = false
  private state: DocumentTitleSaveState = "saved"
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    initialTitle: string,
    private readonly save: (title: string) => Promise<string>,
    private readonly delayMs = 600,
  ) {
    this.authoritativeTitle = normalizeDocumentTitle(initialTitle)
    this.input = initialTitle
  }

  subscribe(listener: Listener): () => void {
    this.listener = listener
    listener(this.snapshot())
    return () => {
      if (this.listener === listener) this.listener = undefined
    }
  }

  change(value: string): void {
    this.input = limitDocumentTitle(value)
    this.state = "pending"
    this.clearTimer()
    this.timer = setTimeout(() => void this.flush().catch(() => undefined), this.delayMs)
    this.emit()
  }

  receiveRemote(value: string): void {
    const title = normalizeDocumentTitle(value)
    if (this.dirty) {
      this.remoteTitle = title
      return
    }
    this.authoritativeTitle = title
    this.input = title
    this.state = "saved"
    this.emit()
  }

  async flush(): Promise<void> {
    if (this.destroyed) return
    this.clearTimer()
    if (this.saving) {
      this.pendingAfterSave = true
      return
    }
    const requested = normalizeDocumentTitle(this.input)
    if (requested === this.authoritativeTitle) {
      this.state = "saved"
      this.emit()
      return
    }
    this.saving = true
    this.state = "saving"
    this.emit()
    try {
      const saved = normalizeDocumentTitle(await this.save(requested))
      const remote = this.remoteTitle
      this.remoteTitle = undefined
      this.authoritativeTitle = remote !== undefined && remote !== saved ? remote : saved
      if (normalizeDocumentTitle(this.input) === requested) {
        this.input = this.authoritativeTitle
        this.state = "saved"
      } else {
        this.state = "pending"
      }
    } catch {
      this.state = "failed"
      throw new Error("保存文档标题失败")
    } finally {
      this.saving = false
      const followUp =
        this.pendingAfterSave || normalizeDocumentTitle(this.input) !== this.authoritativeTitle
      this.pendingAfterSave = false
      this.emit()
      if (!this.destroyed && followUp && this.state !== "failed") void this.flush()
    }
  }

  retry(): Promise<void> {
    return this.flush()
  }

  discardLocal(): void {
    this.clearTimer()
    const next = this.remoteTitle ?? this.authoritativeTitle
    this.remoteTitle = undefined
    this.authoritativeTitle = next
    this.input = next
    this.state = "saved"
    this.emit()
  }

  get dirty(): boolean {
    return (
      this.saving ||
      this.state === "failed" ||
      normalizeDocumentTitle(this.input) !== this.authoritativeTitle
    )
  }

  get value(): DocumentTitleSnapshot {
    return this.snapshot()
  }

  destroy(): void {
    this.destroyed = true
    this.pendingAfterSave = false
    this.clearTimer()
    this.listener = undefined
  }

  private snapshot(): DocumentTitleSnapshot {
    return Object.freeze({
      authoritativeTitle: this.authoritativeTitle,
      input: this.input,
      state: this.state,
    })
  }

  private emit(): void {
    this.listener?.(this.snapshot())
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}

export function normalizeDocumentTitle(value: string): string {
  return value.trim() || "无标题文档"
}

export function limitDocumentTitle(value: string): string {
  return Array.from(value).slice(0, 500).join("")
}
