import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { Copy, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { writeHostClipboardText } from "@/lib/desktop-host"
import {
  buildAppWebSocketURL,
  regenerateClientAppSecret,
  type ClientAppCredentials,
} from "@/lib/client-api/apps"

export function AppCredentialsDialog({
  credentials,
  onCredentialsChange,
  onOpenChange,
  open,
}: {
  credentials: ClientAppCredentials | null
  onCredentialsChange: (credentials: ClientAppCredentials) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useLocale()
  const [resetOpen, setResetOpen] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)

  if (!credentials) {
    return null
  }

  const { app, connectionSecret } = credentials
  const webSocketURL = buildAppWebSocketURL(window.location)

  async function handleResetSecret() {
    if (resetting) {
      return
    }

    setResetting(true)
    try {
      const nextCredentials = await regenerateClientAppSecret(app.id)
      onCredentialsChange(nextCredentials)
      setResetOpen(false)
      toast.success(t("credentials.reset"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("credentials.resetFailed"))
    } finally {
      setResetting(false)
    }
  }

  return (
    <>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!resetting) {
            onOpenChange(nextOpen)
          }
        }}
        open={open}
      >
        <DialogContent
          className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-lg"
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("credentials.title")}</DialogTitle>
            <DialogDescription className="sr-only">{t("credentials.desc")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <CredentialField copyable label={t("credentials.appId")} value={app.id} />
            <CredentialField copyable label={t("credentials.wsUrl")} value={webSocketURL} />
            <CredentialField copyable label={t("credentials.secret")} value={connectionSecret} />
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              disabled={resetting}
              onClick={() => setResetOpen(true)}
              type="button"
              variant="secondary"
            >
              <RotateCcw />
              {t("credentials.resetAction")}
            </Button>
            <Button disabled={resetting} onClick={() => onOpenChange(false)} type="button">
              {t("credentials.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!resetting) {
            setResetOpen(nextOpen)
          }
        }}
        open={resetOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("credentials.resetAction")}</AlertDialogTitle>
            <AlertDialogDescription>{t("credentials.resetDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>{t("credentials.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetting}
              onClick={(event) => {
                event.preventDefault()
                void handleResetSecret()
              }}
              variant="destructive"
            >
              {resetting && <Spinner />}
              {t("credentials.confirmReset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CredentialField({
  copyable = false,
  label,
  value,
}: {
  copyable?: boolean
  label: string
  value: string
}) {
  const { t } = useLocale()
  const inputId = React.useId()

  async function handleCopy() {
    try {
      await writeHostClipboardText(value)
      toast.success(t("credentials.copied", { label }))
    } catch {
      toast.error(t("credentials.copyFailed", { label }))
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input className="min-w-0 flex-1 font-mono! text-xs" id={inputId} readOnly value={value} />
        {copyable && (
          <Button
            aria-label={t("credentials.copy", { label })}
            onClick={() => void handleCopy()}
            size="icon"
            title={t("credentials.copy", { label })}
            type="button"
            variant="outline"
          >
            <Copy />
          </Button>
        )}
      </div>
    </div>
  )
}
