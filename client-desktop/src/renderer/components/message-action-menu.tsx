import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import {
  Copy,
  Ellipsis,
  Forward,
  ListChecks,
  MessageSquareText,
  Reply,
  type LucideIcon,
  Undo2,
} from "lucide-react"

import { messageHoverActionButtonClassName } from "@/components/conversation/message-hover-action-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type MessageActionOptions = {
  canRevoke?: boolean
  copyDisabled?: boolean
  onCopy?: () => void
  onCreateTopic?: () => void
  onForward?: () => void
  onMultiSelect?: () => void
  onReply?: () => void
  onRevoke?: () => void
  showCopy?: boolean
}

type MessageActionItem = {
  disabled: boolean
  icon: LucideIcon
  key: string
  label: string
  onSelect?: () => void
  separatorBefore?: boolean
  variant?: "default" | "destructive"
}

type MessageActionMenuProps = MessageActionOptions & { children: React.ReactNode }

export function MessageActionMenu({ children, ...options }: MessageActionMenuProps) {
  const { t } = useLocale()
  const actions = resolveMessageActions(options, t)

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={cn(
            "z-50 min-w-32 overflow-hidden rounded-md bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10",
            "origin-(--radix-context-menu-content-transform-origin) duration-100",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
          data-slot="message-action-menu"
        >
          {actions.map((action) => (
            <React.Fragment key={action.key}>
              {action.separatorBefore && (
                <ContextMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />
              )}
              <MessageContextMenuItem
                disabled={action.disabled}
                onSelect={action.onSelect}
                variant={action.variant}
              >
                <action.icon aria-hidden="true" className="size-4" />
                <span>{action.label}</span>
              </MessageContextMenuItem>
            </React.Fragment>
          ))}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}

export function MessageMoreActionsMenu({
  align,
  onOpenChange,
  ...options
}: MessageActionOptions & {
  align: "start" | "end"
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useLocale()
  const actions = resolveMessageActions(options, t)

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("messageAction.more")}
          className={messageHoverActionButtonClassName}
          data-slot="message-more-actions"
          title={t("messageAction.more")}
          type="button"
        >
          <Ellipsis className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-32">
        {actions.map((action) => (
          <React.Fragment key={action.key}>
            {action.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={action.disabled}
              onSelect={action.onSelect}
              variant={action.variant}
            >
              <action.icon aria-hidden="true" className="size-4" />
              <span>{action.label}</span>
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function resolveMessageActions(
  {
    canRevoke = false,
    copyDisabled = false,
    onCopy,
    onCreateTopic,
    onForward,
    onMultiSelect,
    onReply,
    onRevoke,
    showCopy = true,
  }: MessageActionOptions,
  t: ReturnType<typeof useLocale>["t"],
): MessageActionItem[] {
  const actions: MessageActionItem[] = [
    {
      disabled: !onReply,
      icon: Reply,
      key: "reply",
      label: t("messageAction.reply"),
      onSelect: onReply,
    },
    {
      disabled: !onForward,
      icon: Forward,
      key: "forward",
      label: t("messageAction.forward"),
      onSelect: onForward,
    },
    {
      disabled: !onMultiSelect,
      icon: ListChecks,
      key: "multi-select",
      label: t("messageAction.multiSelect"),
      onSelect: onMultiSelect,
    },
  ]

  if (showCopy) {
    actions.unshift({
      disabled: copyDisabled,
      icon: Copy,
      key: "copy",
      label: t("messageAction.copy"),
      onSelect: onCopy,
    })
  }

  if (onCreateTopic) {
    actions.push({
      disabled: false,
      icon: MessageSquareText,
      key: "create-topic",
      label: t("messageAction.createTopic"),
      onSelect: onCreateTopic,
    })
  }
  if (canRevoke) {
    actions.push({
      disabled: !onRevoke,
      icon: Undo2,
      key: "revoke",
      label: t("messageAction.revoke"),
      onSelect: onRevoke,
      separatorBefore: true,
      variant: "destructive",
    })
  }

  return actions
}

function MessageContextMenuItem({
  children,
  className,
  disabled = false,
  onSelect,
  variant = "default",
}: {
  children: React.ReactNode
  className?: string
  disabled?: boolean
  onSelect?: () => void
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none",
        "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "destructive" &&
          "text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20",
        className,
      )}
      data-slot="message-action-menu-item"
      data-variant={variant}
      disabled={disabled}
      onSelect={onSelect}
    >
      {children}
    </ContextMenuPrimitive.Item>
  )
}
