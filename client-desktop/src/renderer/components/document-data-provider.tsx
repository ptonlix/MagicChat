import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { ClientDocumentTitle } from "@/components/client-document-title"
import {
  ClientDataRequestError,
  getCurrentClientUser,
  type ClientUser,
} from "@/lib/client-data-api"
import { useAppInfo } from "@/lib/app-info-context"
import { DocumentDataContext } from "@/lib/document-data-context"
import { listClientProjects } from "@/lib/project-data-api"

export function DocumentDataProvider({ children }: { children: ReactNode }) {
  const { setAuthenticated } = useAppInfo()
  const [me, setMe] = useState<ClientUser | null>(null)
  const [error, setError] = useState<ClientDataRequestError | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleRequestError = useCallback(
    (reason: unknown, fallback: string, showStatus = false) => {
      const requestError =
        reason instanceof ClientDataRequestError
          ? reason
          : new ClientDataRequestError(reason instanceof Error ? reason.message : fallback)
      const unauthorized = requestError.status === 401 || requestError.code === "unauthorized"
      if (unauthorized) {
        setAuthenticated(false)
      }
      if (mountedRef.current && (showStatus || unauthorized)) setError(requestError)
      return requestError
    },
    [setAuthenticated],
  )

  const refreshMe = useCallback(async () => {
    try {
      const nextMe = await getCurrentClientUser()
      if (!mountedRef.current) return
      setMe(nextMe)
      setError(null)
      setAuthenticated(true)
    } catch (reason) {
      throw handleRequestError(reason, "加载当前用户失败")
    }
  }, [handleRequestError, setAuthenticated])

  const refreshProjects = useCallback(async () => {
    try {
      await listClientProjects({ limit: 100 })
      if (mountedRef.current) setError(null)
    } catch (reason) {
      throw handleRequestError(reason, "加载项目列表失败")
    }
  }, [handleRequestError])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextMe] = await Promise.all([
        getCurrentClientUser(),
        listClientProjects({ limit: 100 }),
      ])
      if (!mountedRef.current) return
      setMe(nextMe)
      setAuthenticated(true)
    } catch (reason) {
      handleRequestError(reason, "加载文档工作区失败", true)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [handleRequestError, setAuthenticated])

  useEffect(() => {
    void load()
  }, [load])

  const value = useMemo(
    () => (me ? { me, refreshMe, refreshProjects } : null),
    [me, refreshMe, refreshProjects],
  )

  if (loading) return <DocumentDataStatus message="正在连接文档工作区" onRetry={undefined} />
  if (error || !value)
    return (
      <DocumentDataStatus
        message={
          error?.status === 401 || error?.code === "unauthorized"
            ? "当前登录状态已失效，请重新登录后再打开文档。"
            : (error?.message ?? "文档工作区暂时不可用，请重试。")
        }
        onRetry={() => void load()}
      />
    )

  return <DocumentDataContext.Provider value={value}>{children}</DocumentDataContext.Provider>
}

function DocumentDataStatus({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <main className="flex h-svh min-h-0 items-center justify-center px-6 pt-10">
      <ClientDocumentTitle disableMessageAlert title="文档工作区" />
      <section className="max-w-sm space-y-4 border bg-background p-8 text-center">
        <h1 className="text-lg font-semibold">文档工作区</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 focus-visible:ring-2"
            onClick={onRetry}
            type="button"
          >
            重试
          </button>
        )}
      </section>
    </main>
  )
}
