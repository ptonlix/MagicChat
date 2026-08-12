import type { ClientCardSendInput } from "@/lib/client-data-api"

const maxDocumentCardTitleLength = 256
const documentCardTitlePrefix = "文档 - "

export function createDocumentCard(
  documentId: string,
  title: string,
  projectName: string,
): Extract<ClientCardSendInput, { type: "card" }> {
  return {
    description: `项目: ${projectName}`,
    title: createDocumentCardTitle(title),
    type: "card",
    url: `/documents/document/${encodeURIComponent(documentId)}`,
  }
}

export function createDocumentCardTitle(title: string): string {
  const normalizedTitle = title.trim() || "无标题文档"
  const remainingLength = maxDocumentCardTitleLength - Array.from(documentCardTitlePrefix).length
  const characters = Array.from(normalizedTitle)

  if (characters.length <= remainingLength) return documentCardTitlePrefix + normalizedTitle
  return `${documentCardTitlePrefix}${characters.slice(0, remainingLength - 1).join("")}…`
}
