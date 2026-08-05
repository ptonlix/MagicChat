import * as React from "react"
import type { EditorEvents } from "@tiptap/core"
import type { Editor } from "@tiptap/react"

import {
  collectDocumentImageFileIds,
  transactionChangesDocumentImages,
} from "./document-image-extension"
import type { DocumentImageResolution } from "./document-image-resolution"
import { resolveDocumentImageURLs } from "@/lib/document-image-api"

const refreshSafetyMs = 5 * 60 * 1000
const maximumRetries = 3
const maximumTimerDelayMs = 2_147_483_647
type ResolutionReason = "automatic" | "initial" | "manual"

export function useDocumentImageResolutions(editor: Editor | null) {
  const [resolutions, setResolutions] = React.useState<Map<string, DocumentImageResolution>>(
    new Map(),
  )
  const refreshRef = React.useRef<(fileId: string) => void>(() => undefined)

  React.useEffect(() => {
    if (!editor) return
    const activeEditor = editor
    let active = true
    let signature = ""
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const retries = new Map<string, number>()
    const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const requestVersions = new Map<string, number>()
    const current = new Map<string, DocumentImageResolution>()
    const suppressedAutomaticRefresh = new Set<string>()

    const publish = () => active && setResolutions(new Map(current))
    const scheduleExpiry = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      const due = [...current.entries()]
        .filter(
          ([fileId, item]) => item.status === "ready" && !suppressedAutomaticRefresh.has(fileId),
        )
        .map(
          ([, item]) => Date.parse(item.status === "ready" ? item.expiresAt : "") - refreshSafetyMs,
        )
        .filter(Number.isFinite)
      if (due.length === 0) return
      refreshTimer = setTimeout(
        synchronize,
        Math.min(Math.max(Math.min(...due) - Date.now(), 1_000), maximumTimerDelayMs),
      )
    }

    const invalidateFile = (fileId: string) => {
      requestVersions.set(fileId, (requestVersions.get(fileId) ?? 0) + 1)
      retries.delete(fileId)
      const retryTimer = retryTimers.get(fileId)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimers.delete(fileId)
    }

    const resolve = async (fileIds: string[], forceRefresh: boolean, reason: ResolutionReason) => {
      if (fileIds.length === 0) return
      const versions = new Map(
        fileIds.map((fileId) => {
          const version = (requestVersions.get(fileId) ?? 0) + 1
          requestVersions.set(fileId, version)
          return [fileId, version] as const
        }),
      )
      try {
        const result = await resolveDocumentImageURLs(fileIds, forceRefresh)
        if (!active) return
        const activeFileIds = new Set(collectDocumentImageFileIds(activeEditor.state.doc))
        const urls = new Map(result.urls.map((item) => [item.fileId, item]))
        const missing = new Set(result.missingFileIds)
        for (const fileId of fileIds) {
          if (versions.get(fileId) !== requestVersions.get(fileId) || !activeFileIds.has(fileId)) {
            continue
          }
          const item = urls.get(fileId)
          if (
            reason !== "initial" &&
            item &&
            Date.parse(item.expiresAt) - refreshSafetyMs <= Date.now()
          ) {
            // 临时文件本身即将到期时，重新签名无法延长有效期；停止自动刷新以避免请求风暴。
            suppressedAutomaticRefresh.add(fileId)
          } else if (item) {
            suppressedAutomaticRefresh.delete(fileId)
          }
          current.set(
            fileId,
            item
              ? { expiresAt: item.expiresAt, status: "ready", url: item.url }
              : missing.has(fileId)
                ? { status: "failed" }
                : { status: "loading" },
          )
          retries.delete(fileId)
          const retryTimer = retryTimers.get(fileId)
          if (retryTimer) clearTimeout(retryTimer)
          retryTimers.delete(fileId)
        }
        publish()
        scheduleExpiry()
      } catch {
        if (!active) return
        const activeFileIds = new Set(collectDocumentImageFileIds(activeEditor.state.doc))
        for (const fileId of fileIds) {
          if (versions.get(fileId) !== requestVersions.get(fileId) || !activeFileIds.has(fileId)) {
            continue
          }
          const count = (retries.get(fileId) ?? 0) + 1
          retries.set(fileId, count)
          if (count > maximumRetries) {
            current.set(fileId, { status: "failed" })
            continue
          }
          const timer = setTimeout(
            () => {
              retryTimers.delete(fileId)
              void resolve([fileId], true, reason)
            },
            2 ** (count - 1) * 1_000,
          )
          retryTimers.set(fileId, timer)
        }
        publish()
      }
    }

    function synchronize() {
      const ids = collectDocumentImageFileIds(activeEditor.state.doc)
      const nextSignature = [...ids].sort().join("\0")
      const activeIds = new Set(ids)
      for (const id of current.keys()) {
        if (activeIds.has(id)) continue
        invalidateFile(id)
        current.delete(id)
        suppressedAutomaticRefresh.delete(id)
      }
      const added = ids.filter((id) => !current.has(id))
      for (const id of added) current.set(id, { status: "loading" })
      signature = nextSignature
      publish()
      const unresolved = ids.filter((id) => current.get(id)?.status === "loading")
      const expiring = ids.filter((id) => {
        const item = current.get(id)
        return (
          item?.status === "ready" &&
          !suppressedAutomaticRefresh.has(id) &&
          Date.parse(item.expiresAt) - refreshSafetyMs <= Date.now()
        )
      })
      void resolve(unresolved, false, "initial")
      void resolve(expiring, true, "automatic")
    }

    refreshRef.current = (fileId) => {
      invalidateFile(fileId)
      suppressedAutomaticRefresh.delete(fileId)
      current.set(fileId, { status: "loading" })
      publish()
      void resolve([fileId], true, "manual")
    }
    const onTransaction = ({ transaction }: EditorEvents["transaction"]) => {
      if (!transactionChangesDocumentImages(transaction)) return
      const next = [...collectDocumentImageFileIds(activeEditor.state.doc)].sort().join("\0")
      if (next !== signature) synchronize()
    }
    activeEditor.on("transaction", onTransaction)
    synchronize()
    return () => {
      active = false
      refreshRef.current = () => undefined
      if (refreshTimer) clearTimeout(refreshTimer)
      for (const timer of retryTimers.values()) clearTimeout(timer)
      activeEditor.off("transaction", onTransaction)
    }
  }, [editor])

  return {
    refresh: React.useCallback((fileId: string) => refreshRef.current(fileId), []),
    resolutions,
  }
}
