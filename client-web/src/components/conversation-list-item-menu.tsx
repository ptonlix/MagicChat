import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { BellOff, Pin } from "lucide-react"

import { cn } from "@/lib/utils"

type ConversationListItemMenuProps = {
  children: React.ReactNode
}

const conversationActions = [
  { label: "置顶对话", icon: Pin },
  { label: "消息免打扰", icon: BellOff },
] as const

export function ConversationListItemMenu({
  children,
}: ConversationListItemMenuProps) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={cn(
            "z-50 min-w-36 overflow-hidden rounded-md bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10",
            "origin-(--radix-context-menu-content-transform-origin) duration-100",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          )}
          data-slot="conversation-list-item-menu"
        >
          {conversationActions.map((action) => (
            <ContextMenuPrimitive.Item
              className={cn(
                "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden",
                "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground",
                "data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
              )}
              data-slot="conversation-list-item-menu-item"
              key={action.label}
            >
              <action.icon aria-hidden="true" className="size-4" />
              <span>{action.label}</span>
            </ContextMenuPrimitive.Item>
          ))}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}
