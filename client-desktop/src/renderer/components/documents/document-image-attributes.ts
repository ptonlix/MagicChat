export type DocumentImageAttributes = Readonly<{
  alignment: "center" | "left" | "right"
  alt: string
  externalUrl: string | null
  fileId: string | null
  width: number
}>

export function normalizeDocumentImageAttributes(
  attributes: Record<string, unknown>,
): DocumentImageAttributes {
  const width = Number(attributes.width)
  const alignment = attributes.alignment
  return {
    alignment: alignment === "left" || alignment === "right" ? alignment : "center",
    alt: typeof attributes.alt === "string" ? attributes.alt.slice(0, 500) : "",
    externalUrl: typeof attributes.externalUrl === "string" ? attributes.externalUrl : null,
    fileId:
      typeof attributes.fileId === "string" && /^[\w-]{1,200}$/.test(attributes.fileId)
        ? attributes.fileId
        : null,
    width: Number.isFinite(width) && width >= 20 && width <= 100 ? Math.round(width / 5) * 5 : 100,
  }
}

export function isLoadableDocumentExternalImage(value: string | null): boolean {
  if (!value) return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}
