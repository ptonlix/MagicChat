import { LogInIcon, MoveRight } from "lucide-react"
import { useEffect, useRef, useState, type MouseEvent } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { useLocale } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import { LoginForm } from "@/components/login-form"
import { Separator } from "@/components/ui/separator"
import { useAppInfo } from "@/lib/app-info-context"
import { clientEmailCodeLogin, clientLogin, requestClientEmailCode } from "@/lib/client-auth"
import {
  cancelThirdPartyLogin,
  openThirdPartyLogin,
  subscribeThirdPartyLoginFinished,
} from "@/lib/desktop-host"

export function LoginPage() {
  const { t } = useLocale()
  const {
    authenticated,
    emailCodeLoginEnabled,
    organizationName,
    passwordLoginEnabled,
    setAuthenticated,
    thirdPartyProviders,
  } = useAppInfo()
  const navigate = useNavigate()
  const hasThirdPartyProviders = thirdPartyProviders.length > 0
  const [pendingThirdParty, setPendingThirdParty] = useState<{
    providerName: string
    transactionId: string
  }>()
  const [thirdPartyStarting, setThirdPartyStarting] = useState(false)
  const thirdPartyTransactionRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const unsubscribe = subscribeThirdPartyLoginFinished((result) => {
      if (result.transactionId !== thirdPartyTransactionRef.current) return
      thirdPartyTransactionRef.current = undefined
      setPendingThirdParty(undefined)
      setThirdPartyStarting(false)
      if (result.status === "canceled") {
        toast.info(t("login.thirdPartyClosed"))
      } else if (result.status === "error") {
        toast.error(result.error ?? t("login.thirdPartyFailed"))
      }
    })
    return () => {
      unsubscribe()
      if (thirdPartyTransactionRef.current) {
        void cancelThirdPartyLogin(thirdPartyTransactionRef.current)
      }
    }
  }, [t])

  useEffect(() => {
    if (authenticated) {
      navigate("/init", { replace: true })
    }
  }, [authenticated, navigate])

  async function handleLogin(credentials: { account: string; password: string }) {
    await clientLogin(credentials)
    setAuthenticated(true)
    navigate("/init", { replace: true })
  }

  async function handleEmailCodeLogin(credentials: { code: string; email: string }) {
    await clientEmailCodeLogin(credentials)
    setAuthenticated(true)
    navigate("/init", { replace: true })
  }

  async function handleRequestEmailCode(email: string) {
    return requestClientEmailCode(email)
  }

  async function handleThirdPartyLogin(
    event: MouseEvent<HTMLAnchorElement>,
    providerKey: string,
    providerName: string,
  ) {
    event.preventDefault()
    if (thirdPartyStarting) return
    setThirdPartyStarting(true)
    try {
      const transaction = await openThirdPartyLogin(providerKey)
      thirdPartyTransactionRef.current = transaction.transactionId
      setPendingThirdParty({ providerName, transactionId: transaction.transactionId })
      toast.info(t("login.thirdPartyOpened"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("login.thirdPartyStartFailed"))
    } finally {
      setThirdPartyStarting(false)
    }
  }

  async function handleThirdPartyCancel() {
    if (!pendingThirdParty) return
    try {
      await cancelThirdPartyLogin(pendingThirdParty.transactionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("login.thirdPartyCancelFailed"))
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-left text-2xl font-medium">
              {t("login.title", { appName: t("brand.name") })}
            </h1>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MoveRight className="size-4" />
              <span>{t("login.workspace", { name: organizationName })}</span>
            </p>
          </div>
          <LoginForm
            className="w-full"
            emailCodeLoginEnabled={emailCodeLoginEnabled}
            onEmailCodeLogin={handleEmailCodeLogin}
            onLogin={handleLogin}
            onRequestEmailCode={handleRequestEmailCode}
            passwordLoginEnabled={passwordLoginEnabled}
            submitVariant={hasThirdPartyProviders ? "outline" : "default"}
          >
            {hasThirdPartyProviders && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Separator className="flex-1" />
                  <span className="shrink-0">{t("login.otherMethods")}</span>
                  <Separator className="flex-1" />
                </div>
                <div className="flex flex-col gap-2">
                  {pendingThirdParty ? (
                    <Button
                      onClick={() => void handleThirdPartyCancel()}
                      type="button"
                      variant="outline"
                    >
                      {t("login.cancelProvider", { name: pendingThirdParty.providerName })}
                    </Button>
                  ) : (
                    thirdPartyProviders.map((provider, index) => (
                      <Button
                        asChild
                        key={provider.key}
                        variant={index === 0 ? "default" : "outline"}
                      >
                        <a
                          aria-disabled={thirdPartyStarting}
                          href={`/api/client/auth/third-party/${encodeURIComponent(
                            provider.key,
                          )}/start?redirect=/init`}
                          onClick={(event) =>
                            void handleThirdPartyLogin(event, provider.key, provider.name)
                          }
                        >
                          <LogInIcon data-icon="inline-start" />
                          {t("login.withProvider", { name: provider.name })}
                        </a>
                      </Button>
                    ))
                  )}
                </div>
              </div>
            )}
          </LoginForm>
        </div>
      </main>
    </div>
  )
}
