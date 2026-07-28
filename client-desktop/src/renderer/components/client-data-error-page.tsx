import { AlertTriangle, CloudOff, RefreshCw, Server, ShieldCheck, Wifi } from "lucide-react"

import { ClientDocumentTitle } from "@/components/client-document-title"
import { Button } from "@/components/ui/button"

type ClientDataErrorPageProps = {
  message: string
  onRetry: () => void
}

const connectionChecks = [
  {
    description: "确认当前设备可以正常访问网络",
    icon: Wifi,
    title: "网络连接",
  },
  {
    description: "确认工作区服务器正在运行",
    icon: Server,
    title: "服务状态",
  },
  {
    description: "重新连接不会影响本地设置",
    icon: ShieldCheck,
    title: "数据安全",
  },
]

export function ClientDataErrorPage({ message, onRetry }: ClientDataErrorPageProps) {
  return (
    <>
      <ClientDocumentTitle title="工作区加载失败" disableMessageAlert />
      <main className="client-data-error-page min-h-svh bg-background pt-10 text-foreground">
        <header className="client-data-error-header">
          <div className="client-data-error-brand">
            <img alt="即应" src="/logo.png" />
            <strong>即应</strong>
            <span aria-hidden="true" />
            <p>工作空间</p>
          </div>
        </header>

        <div className="client-data-error-layout">
          <section className="client-data-error-content" aria-labelledby="workspace-error-title">
            <div className="client-data-error-icon" aria-hidden="true">
              <CloudOff />
            </div>
            <p className="client-data-error-eyebrow">连接中断</p>
            <h1 id="workspace-error-title">工作区加载失败</h1>
            <p className="client-data-error-description">
              即应暂时无法完成工作区同步。你可以重新加载，恢复后会回到原来的工作状态。
            </p>

            <div className="client-data-error-detail" role="alert">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>未能连接工作区</strong>
                <p>{message}</p>
              </div>
            </div>

            <div className="client-data-error-actions">
              <Button className="client-data-error-retry" onClick={onRetry} size="lg" type="button">
                <RefreshCw aria-hidden="true" />
                重新加载
              </Button>
              <p>仍无法进入？请检查网络与服务器状态后再试。</p>
            </div>
          </section>

          <aside className="client-data-error-checks" aria-label="连接检查">
            <div className="client-data-error-checks-heading">
              <span aria-hidden="true" />
              <p>连接检查</p>
            </div>
            <div className="client-data-error-check-list">
              {connectionChecks.map(({ description, icon: Icon, title }) => (
                <div className="client-data-error-check" key={title}>
                  <Icon aria-hidden="true" />
                  <div>
                    <strong>{title}</strong>
                    <p>{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </main>
    </>
  )
}
