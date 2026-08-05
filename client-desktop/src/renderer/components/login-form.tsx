import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from "react"
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { useLocale } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type LoginCredentials = {
  account: string
  password: string
}

type EmailCodeLoginCredentials = {
  code: string
  email: string
}

type EmailCodeRequestResult = {
  retryAfterSeconds: number
}

type LoginMode = "password" | "email-code"

const rememberedLoginStorageKey = "client-desktop:remembered-login"
const rememberedEmailCodeLoginStorageKey = "client-desktop:remembered-email-code-login"

type RememberedLoginCredentials = LoginCredentials

export function LoginForm({
  children,
  className,
  emailCodeLoginEnabled = true,
  onEmailCodeLogin,
  onLogin,
  onRequestEmailCode,
  passwordLoginEnabled = true,
  submitVariant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  children?: ReactNode
  emailCodeLoginEnabled?: boolean
  onEmailCodeLogin?: (credentials: EmailCodeLoginCredentials) => Promise<void> | void
  onLogin?: (credentials: LoginCredentials) => Promise<void> | void
  onRequestEmailCode?: (email: string) => Promise<EmailCodeRequestResult> | EmailCodeRequestResult
  passwordLoginEnabled?: boolean
  submitVariant?: "default" | "outline"
}) {
  const { t } = useLocale()
  const [rememberedCredentials] = useState(readRememberedLoginCredentials)
  const [account, setAccount] = useState(rememberedCredentials?.account ?? "")
  const [email, setEmail] = useState(readRememberedEmailCodeLoginEmail)
  const [emailCode, setEmailCode] = useState("")
  const [emailCodeLoginPending, setEmailCodeLoginPending] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>("email-code")
  const [password, setPassword] = useState(rememberedCredentials?.password ?? "")
  const [passwordLoginPending, setPasswordLoginPending] = useState(false)
  const [rememberCredentials, setRememberCredentials] = useState(Boolean(rememberedCredentials))
  const [requestCodePending, setRequestCodePending] = useState(false)
  const [retryCodeAfter, setRetryCodeAfter] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const pending = passwordLoginPending || emailCodeLoginPending || requestCodePending
  const activeLoginMode = emailCodeLoginEnabled
    ? passwordLoginEnabled
      ? loginMode
      : "email-code"
    : "password"
  const localLoginEnabled = emailCodeLoginEnabled || passwordLoginEnabled

  useEffect(() => {
    if (retryCodeAfter <= 0) {
      return
    }
    const timer = window.setTimeout(() => {
      setRetryCodeAfter((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [retryCodeAfter])

  async function handlePasswordSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    setPasswordLoginPending(true)

    try {
      await onLogin?.({
        account,
        password,
      })
      updateRememberedLoginCredentials(rememberCredentials, {
        account,
        password,
      })
    } catch (loginError) {
      toast.error(getLoginErrorMessage(loginError, t))
    } finally {
      setPasswordLoginPending(false)
    }
  }

  async function handleRequestEmailCode() {
    if (!emailInputRef.current?.reportValidity()) {
      return
    }

    setRequestCodePending(true)
    try {
      if (!onRequestEmailCode) {
        throw new Error(t("login.emailCodeUnsupported"))
      }
      const result = await onRequestEmailCode(email.trim())
      setRetryCodeAfter(Math.max(1, Math.ceil(result.retryAfterSeconds)))
      toast.success(t("login.codeSent"))
    } catch (requestError) {
      toast.error(getEmailCodeRequestErrorMessage(requestError, t))
    } finally {
      setRequestCodePending(false)
    }
  }

  async function handleEmailCodeSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    setEmailCodeLoginPending(true)
    try {
      if (!onEmailCodeLogin) {
        throw new Error(t("login.emailCodeUnsupported"))
      }
      const normalizedEmail = email.trim()
      await onEmailCodeLogin({ code: emailCode, email: normalizedEmail })
      updateRememberedEmailCodeLoginEmail(normalizedEmail)
    } catch (loginError) {
      toast.error(getLoginErrorMessage(loginError, t))
    } finally {
      setEmailCodeLoginPending(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardContent className="flex flex-col gap-5">
          {localLoginEnabled && (
            <Tabs
              onValueChange={(mode) => {
                if (mode === "password" || mode === "email-code") {
                  setLoginMode(mode)
                }
              }}
              value={activeLoginMode}
            >
              <TabsList
                className={cn(
                  "grid w-full",
                  emailCodeLoginEnabled && passwordLoginEnabled ? "grid-cols-2" : "grid-cols-1",
                )}
              >
                {emailCodeLoginEnabled && (
                  <TabsTrigger disabled={pending} value="email-code">
                    {t("login.tabEmailCode")}
                  </TabsTrigger>
                )}
                {passwordLoginEnabled && (
                  <TabsTrigger disabled={pending} value="password">
                    {t("login.tabPassword")}
                  </TabsTrigger>
                )}
              </TabsList>

              {emailCodeLoginEnabled && (
                <TabsContent className="pt-2" value="email-code">
                  <form onSubmit={handleEmailCodeSubmit}>
                    <FieldGroup className="gap-4">
                      <Field>
                        <FieldLabel htmlFor="email-code-email">{t("login.email")}</FieldLabel>
                        <Input
                          autoComplete="email"
                          disabled={pending}
                          id="email-code-email"
                          name="email"
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder={t("login.emailPlaceholder")}
                          ref={emailInputRef}
                          required
                          type="email"
                          value={email}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="email-code">{t("login.code")}</FieldLabel>
                        <InputGroup>
                          <InputGroupInput
                            autoComplete="one-time-code"
                            disabled={pending}
                            id="email-code"
                            inputMode="numeric"
                            maxLength={8}
                            name="code"
                            onChange={(event) =>
                              setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 8))
                            }
                            pattern="[0-9]{8}"
                            placeholder={t("login.codePlaceholder")}
                            required
                            value={emailCode}
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              className="min-w-20"
                              disabled={pending || retryCodeAfter > 0}
                              onClick={handleRequestEmailCode}
                            >
                              {requestCodePending && (
                                <Loader2Icon aria-hidden="true" className="animate-spin" />
                              )}
                              {requestCodePending
                                ? t("login.sending")
                                : retryCodeAfter > 0
                                  ? t("login.retryIn", { seconds: retryCodeAfter })
                                  : t("login.getCode")}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </Field>
                      <Field>
                        <Button disabled={pending} type="submit" variant={submitVariant}>
                          {emailCodeLoginPending && (
                            <Loader2Icon aria-hidden="true" className="animate-spin" />
                          )}
                          {t("login.signIn")}
                        </Button>
                      </Field>
                    </FieldGroup>
                  </form>
                </TabsContent>
              )}

              {passwordLoginEnabled && (
                <TabsContent className="pt-2" value="password">
                  <form onSubmit={handlePasswordSubmit}>
                    <FieldGroup className="gap-4">
                      <Field>
                        <FieldLabel htmlFor="account">{t("login.account")}</FieldLabel>
                        <Input
                          autoComplete="username"
                          disabled={pending}
                          id="account"
                          name="account"
                          onChange={(event) => {
                            setAccount(event.target.value)
                          }}
                          placeholder={t("login.accountPlaceholder")}
                          required
                          type="text"
                          value={account}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="password">{t("login.password")}</FieldLabel>
                        <InputGroup>
                          <InputGroupInput
                            autoComplete="current-password"
                            disabled={pending}
                            id="password"
                            name="password"
                            onChange={(event) => {
                              setPassword(event.target.value)
                            }}
                            placeholder={t("login.passwordPlaceholder")}
                            required
                            type={showPassword ? "text" : "password"}
                            value={password}
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              aria-label={
                                showPassword ? t("login.hidePassword") : t("login.showPassword")
                              }
                              aria-pressed={showPassword}
                              disabled={pending}
                              onClick={() => setShowPassword((visible) => !visible)}
                              size="icon-xs"
                            >
                              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </Field>
                      <div className="flex w-fit items-center gap-2 text-sm text-muted-foreground select-none">
                        <Checkbox
                          checked={rememberCredentials}
                          disabled={pending}
                          id="remember-credentials"
                          onCheckedChange={(checked) => setRememberCredentials(checked === true)}
                        />
                        <Label htmlFor="remember-credentials">{t("login.remember")}</Label>
                      </div>
                      <Field>
                        <Button disabled={pending} type="submit" variant={submitVariant}>
                          {passwordLoginPending && (
                            <Loader2Icon aria-hidden="true" className="animate-spin" />
                          )}
                          {t("login.signIn")}
                        </Button>
                      </Field>
                    </FieldGroup>
                  </form>
                </TabsContent>
              )}
            </Tabs>
          )}
          {children}
        </CardContent>
      </Card>
    </div>
  )
}

function getLoginErrorMessage(error: unknown, t: ReturnType<typeof useLocale>["t"]) {
  if (error instanceof Error) {
    return error.message
  }

  return t("login.failed")
}

function getEmailCodeRequestErrorMessage(error: unknown, t: ReturnType<typeof useLocale>["t"]) {
  if (error instanceof Error) {
    return error.message
  }

  return t("login.codeSendFailed")
}

function readRememberedLoginCredentials(): RememberedLoginCredentials | null {
  try {
    const value = window.localStorage.getItem(rememberedLoginStorageKey)

    if (!value) {
      return null
    }

    const parsed = JSON.parse(value) as Partial<RememberedLoginCredentials>

    if (typeof parsed.account !== "string") {
      return null
    }

    if (typeof parsed.password !== "string") {
      return null
    }

    return {
      account: parsed.account,
      password: parsed.password,
    }
  } catch {
    return null
  }
}

function updateRememberedLoginCredentials(
  remember: boolean,
  credentials: RememberedLoginCredentials,
) {
  try {
    if (!remember) {
      window.localStorage.removeItem(rememberedLoginStorageKey)
      return
    }

    window.localStorage.setItem(rememberedLoginStorageKey, JSON.stringify(credentials))
  } catch {
    // Login should not fail just because the browser rejected local storage.
  }
}

function readRememberedEmailCodeLoginEmail() {
  try {
    return window.localStorage.getItem(rememberedEmailCodeLoginStorageKey) ?? ""
  } catch {
    return ""
  }
}

function updateRememberedEmailCodeLoginEmail(email: string) {
  try {
    window.localStorage.setItem(rememberedEmailCodeLoginStorageKey, email)
  } catch {
    // Login should not fail just because the browser rejected local storage.
  }
}
