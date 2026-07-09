import { pinyin } from "pinyin-pro"

export function createPinyinSearchText(
  values: Array<string | null | undefined>
) {
  const tokens = new Set<string>()

  for (const value of values) {
    addSearchToken(tokens, value)
  }

  return Array.from(tokens).join(" ")
}

export function normalizePinyinSearchQuery(value: string) {
  return normalizeSearchToken(value)
}

function addSearchToken(tokens: Set<string>, value: string | null | undefined) {
  const normalizedValue = normalizeSearchToken(value ?? "")
  if (!normalizedValue) {
    return
  }

  tokens.add(normalizedValue)

  const rawValue = value?.trim() ?? ""
  if (!hasChineseCharacter(rawValue)) {
    return
  }

  addPinyinToken(
    tokens,
    pinyin(rawValue, { toneType: "none", type: "array" }).join("")
  )
  addPinyinToken(
    tokens,
    pinyin(rawValue, {
      pattern: "first",
      toneType: "none",
      type: "array",
    }).join("")
  )
}

function addPinyinToken(tokens: Set<string>, value: string) {
  const normalizedValue = normalizeSearchToken(value)
  if (!normalizedValue) {
    return
  }

  tokens.add(normalizedValue)

  if (normalizedValue.includes("ü")) {
    tokens.add(normalizedValue.replaceAll("ü", "v"))
    tokens.add(normalizedValue.replaceAll("ü", "u"))
  }
}

function normalizeSearchToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

function hasChineseCharacter(value: string) {
  return /[\u3400-\u9fff]/.test(value)
}
