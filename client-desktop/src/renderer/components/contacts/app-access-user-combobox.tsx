import * as React from "react"
import { useLocale } from "@/components/locale-provider"

import { SelectionListAvatar } from "@/components/selection-list-avatar"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import type { ContactUser } from "@/lib/client-data-api"
import { createPinyinSearchText, normalizePinyinSearchQuery } from "@/lib/pinyin-search"

export function AppAccessUserCombobox({
  disabled = false,
  onValueChange,
  portalContainer,
  users,
  value,
}: {
  disabled?: boolean
  onValueChange: (users: ContactUser[]) => void
  portalContainer: React.RefObject<HTMLDivElement | null>
  users: ContactUser[]
  value: ContactUser[]
}) {
  const { t } = useLocale()

  const anchor = useComboboxAnchor()

  return (
    <Combobox<ContactUser, true>
      disabled={disabled}
      filter={contactMatchesQuery}
      isItemEqualToValue={(user, selected) => user.id === selected.id}
      itemToStringLabel={getContactDisplayName}
      itemToStringValue={(user) => user.id}
      items={users}
      multiple
      onValueChange={onValueChange}
      value={value}
    >
      <div ref={anchor}>
        <ComboboxChips className="max-h-24 overflow-y-auto">
          {value.map((user) => (
            <ComboboxChip key={user.id}>{getContactDisplayName(user)}</ComboboxChip>
          ))}
          <ComboboxChipsInput
            aria-label={t("accessUser.aria")}
            disabled={disabled}
            placeholder={value.length > 0 ? t("accessUser.add") : t("accessUser.search")}
          />
        </ComboboxChips>
      </div>
      <ComboboxContent anchor={anchor} container={portalContainer}>
        <ComboboxEmpty>{t("accessUser.empty")}</ComboboxEmpty>
        <ComboboxList>
          {(user: ContactUser) => {
            const displayName = getContactDisplayName(user)

            return (
              <ComboboxItem key={user.id} value={user}>
                <SelectionListAvatar avatar={user.avatar} name={displayName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
              </ComboboxItem>
            )
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function contactMatchesQuery(user: ContactUser, query: string) {
  const normalizedQuery = normalizePinyinSearchQuery(query)

  if (!normalizedQuery) {
    return true
  }

  return createPinyinSearchText([user.email, user.name, user.nickname, user.phone]).includes(
    normalizedQuery,
  )
}

function getContactDisplayName(user: ContactUser) {
  return user.nickname.trim() || user.name.trim()
}
