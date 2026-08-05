const allowedTags = new Set([
  "A",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "EM",
  "H1",
  "H2",
  "H3",
  "HR",
  "LI",
  "MARK",
  "OL",
  "P",
  "PRE",
  "S",
  "SPAN",
  "STRONG",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "U",
  "UL",
])
const discardedTags = new Set([
  "BUTTON",
  "CANVAS",
  "EMBED",
  "FORM",
  "IFRAME",
  "INPUT",
  "LINK",
  "MATH",
  "META",
  "NOSCRIPT",
  "OBJECT",
  "SCRIPT",
  "SELECT",
  "STYLE",
  "SVG",
  "TEXTAREA",
])
const blockTags = new Set([
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "HR",
  "LI",
  "OL",
  "P",
  "PRE",
  "TABLE",
  "UL",
])
const lineStyles = new Set(["dashed", "dotted", "double", "solid"])
const alignments = new Set(["center", "left", "right"])

export function sanitizeDocumentPasteHTML(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html")
  sanitizeChildren(parsed.body)
  return parsed.body.innerHTML
}

function sanitizeChildren(parent: Element): void {
  for (const child of [...parent.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) child.remove()
    else if (child instanceof Element) sanitizeElement(child)
    else if (child.nodeType === Node.TEXT_NODE && !["CODE", "PRE"].includes(parent.tagName)) {
      child.textContent = child.textContent?.replaceAll("\u00a0", " ") ?? ""
    }
  }
}

function sanitizeElement(original: Element): void {
  let element = original
  if (discardedTags.has(element.tagName)) {
    element.remove()
    return
  }
  if (element.tagName === "IMG") {
    replaceImage(element)
    return
  }
  if (element.tagName === "FIGURE") {
    sanitizeImageFigure(element)
    return
  }
  if (element.tagName === "B") element = replaceTag(element, "strong")
  else if (element.tagName === "I") element = replaceTag(element, "em")
  else if (["DEL", "STRIKE"].includes(element.tagName)) element = replaceTag(element, "s")
  else if (/^H[4-6]$/.test(element.tagName)) element = replaceTag(element, "h3")

  const presentation = readPresentation(element)
  sanitizeChildren(element)
  if (["DIV", "ARTICLE", "SECTION"].includes(element.tagName)) {
    if (hasBlockChildren(element) || element.closest('li[data-type="taskItem"]')) {
      unwrap(element)
      return
    }
    element = replaceTag(element, "p")
  }
  if (!allowedTags.has(element.tagName)) {
    unwrap(element)
    return
  }
  if (element.tagName === "TABLE") promoteFirstTableRow(element)
  removeAttributes(element)
  restoreAttributes(element, presentation)
  restoreInlineStyle(element, presentation)
  if (element.tagName === "SPAN" && !element.hasAttribute("style")) unwrap(element)
}

function readPresentation(element: Element) {
  const htmlElement = element as HTMLElement
  const numericWeight = Number.parseInt(htmlElement.style.fontWeight, 10)
  return {
    backgroundColor: sanitizeColor(
      element.getAttribute("data-color") || htmlElement.style.backgroundColor,
    ),
    bold:
      ["bold", "bolder"].includes(htmlElement.style.fontWeight) ||
      (Number.isFinite(numericWeight) && numericWeight >= 600),
    checked: element.getAttribute("data-checked"),
    color: sanitizeColor(htmlElement.style.color),
    colspan: element.getAttribute("colspan"),
    colwidth: element.getAttribute("colwidth") || element.getAttribute("data-colwidth"),
    fontStyle: htmlElement.style.fontStyle,
    href: element.getAttribute("href"),
    lineStyle: element.getAttribute("data-line-style"),
    listStart: element.getAttribute("start"),
    rowspan: element.getAttribute("rowspan"),
    taskType: element.getAttribute("data-type"),
    textAlign: htmlElement.style.textAlign || element.getAttribute("align"),
    textDecoration: htmlElement.style.textDecorationLine || htmlElement.style.textDecoration,
    thickness: element.getAttribute("data-thickness"),
  }
}

function restoreAttributes(element: Element, value: ReturnType<typeof readPresentation>): void {
  if (element.tagName === "A") {
    const href = sanitizeLinkUrl(value.href)
    if (href) element.setAttribute("href", href)
  }
  if (element.tagName === "OL") {
    const start = normalizeInteger(value.listStart, 1, 10_000)
    if (start && start !== 1) element.setAttribute("start", String(start))
  }
  if (element.tagName === "UL" && value.taskType === "taskList")
    element.setAttribute("data-type", "taskList")
  if (element.tagName === "LI" && value.taskType === "taskItem") {
    element.setAttribute("data-type", "taskItem")
    element.setAttribute(
      "data-checked",
      value.checked === "true" || value.checked === "" ? "true" : "false",
    )
  }
  if (["TD", "TH"].includes(element.tagName)) {
    const colspan = normalizeInteger(value.colspan, 1, 100) ?? 1
    const rowspan = normalizeInteger(value.rowspan, 1, 100) ?? 1
    const widths = sanitizeColumnWidths(value.colwidth, colspan)
    if (colspan !== 1) element.setAttribute("colspan", String(colspan))
    if (rowspan !== 1) element.setAttribute("rowspan", String(rowspan))
    if (widths) element.setAttribute("colwidth", widths)
  }
  if (element.tagName === "HR") {
    element.setAttribute("data-thickness", String(normalizeInteger(value.thickness, 1, 6) ?? 1))
    element.setAttribute(
      "data-line-style",
      lineStyles.has(value.lineStyle ?? "") ? value.lineStyle! : "solid",
    )
  }
  if (
    (element.tagName === "P" || /^H[1-3]$/.test(element.tagName)) &&
    value.textAlign &&
    alignments.has(value.textAlign)
  ) {
    element.setAttribute("style", `text-align: ${value.textAlign}`)
  }
}

function restoreInlineStyle(element: Element, value: ReturnType<typeof readPresentation>): void {
  if (hasBlockChildren(element)) return
  if (value.bold && element.tagName !== "STRONG") wrapChildren(element, "strong")
  if (value.fontStyle === "italic" && element.tagName !== "EM") wrapChildren(element, "em")
  if (value.textDecoration.includes("underline") && element.tagName !== "U")
    wrapChildren(element, "u")
  if (value.textDecoration.includes("line-through") && element.tagName !== "S")
    wrapChildren(element, "s")
  if (value.backgroundColor) {
    const mark = element.tagName === "MARK" ? element : wrapChildren(element, "mark")
    mark.setAttribute("data-color", value.backgroundColor)
    mark.setAttribute("style", `background-color: ${value.backgroundColor}; color: inherit`)
  }
  if (value.color) {
    const span = element.tagName === "SPAN" ? element : wrapChildren(element, "span")
    span.setAttribute("style", `color: ${value.color}`)
  }
}

function sanitizeImageFigure(element: Element): void {
  if (!element.hasAttribute("data-document-image")) {
    sanitizeChildren(element)
    unwrap(element)
    return
  }
  const source = sanitizeImageUrl(element.getAttribute("data-external-url"))
  const fileId = sanitizeFileId(element.getAttribute("data-file-id"))
  if (!source && !fileId) {
    element.remove()
    return
  }
  const alignment = element.getAttribute("data-alignment")
  const width = normalizeInteger(element.getAttribute("data-width"), 20, 100) ?? 100
  const alt = (element.getAttribute("data-alt") ?? "").slice(0, 500)
  removeAttributes(element)
  element.setAttribute("data-document-image", "")
  element.setAttribute(
    "data-alignment",
    alignment === "left" || alignment === "right" ? alignment : "center",
  )
  element.setAttribute("data-alt", alt)
  element.setAttribute("data-width", String(Math.round(width / 5) * 5))
  if (source) element.setAttribute("data-external-url", source)
  if (fileId) element.setAttribute("data-file-id", fileId)
  element.replaceChildren(createImageLabel(element.ownerDocument))
}

function replaceImage(element: Element): void {
  const source = sanitizeImageUrl(element.getAttribute("src"))
  if (!source) {
    element.remove()
    return
  }
  const figure = element.ownerDocument.createElement("figure")
  figure.setAttribute("data-document-image", "")
  figure.setAttribute("data-alignment", "center")
  figure.setAttribute("data-alt", (element.getAttribute("alt") ?? "").slice(0, 500))
  figure.setAttribute("data-external-url", source)
  figure.setAttribute("data-width", "100")
  figure.append(createImageLabel(element.ownerDocument))
  element.replaceWith(figure)
}

function sanitizeImageUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === "https:" ? parsed.toString() : null
  } catch {
    return null
  }
}

function sanitizeLinkUrl(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return /^(https?:|mailto:|tel:)/i.test(trimmed) ? trimmed : null
}

function sanitizeColor(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/\s*!important\s*$/i, "")
  if (!/^oklch\([\d.%+\-\s/]+\)$/i.test(trimmed) && !/^#[0-9a-f]{3,8}$/i.test(trimmed)) return null
  const probe = document.createElement("span")
  probe.style.color = trimmed
  return probe.style.color ? trimmed : null
}

function sanitizeFileId(value: string | null): string | null {
  return value && /^[\w-]{1,200}$/.test(value) ? value : null
}

function sanitizeColumnWidths(value: string | null, colspan: number): string | null {
  if (!value) return null
  const widths = value.split(",").map((item) => normalizeInteger(item, 20, 2_000))
  return widths.length === colspan && widths.every(Boolean) ? widths.join(",") : null
}

function normalizeInteger(value: string | null, minimum: number, maximum: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return parsed >= minimum && parsed <= maximum ? parsed : null
}

function promoteFirstTableRow(table: Element): void {
  const firstRow = table.querySelector("tr")
  for (const cell of firstRow ? [...firstRow.children] : []) {
    if (cell.tagName === "TD") replaceTag(cell, "th")
  }
}

function createImageLabel(owner: Document): HTMLElement {
  const label = owner.createElement("span")
  label.textContent = "文档图片"
  return label
}

function removeAttributes(element: Element): void {
  for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name)
}

function hasBlockChildren(element: Element): boolean {
  return [...element.children].some((child) => blockTags.has(child.tagName))
}

function replaceTag(element: Element, tag: string): Element {
  const replacement = element.ownerDocument.createElement(tag)
  for (const attribute of [...element.attributes])
    replacement.setAttribute(attribute.name, attribute.value)
  replacement.append(...element.childNodes)
  element.replaceWith(replacement)
  return replacement
}

function wrapChildren(element: Element, tag: string): Element {
  const wrapper = element.ownerDocument.createElement(tag)
  wrapper.append(...element.childNodes)
  element.append(wrapper)
  return wrapper
}

function unwrap(element: Element): void {
  element.replaceWith(...element.childNodes)
}
