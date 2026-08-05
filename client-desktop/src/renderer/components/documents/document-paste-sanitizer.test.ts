import { describe, expect, it } from "vitest"
import { sanitizeDocumentPasteHTML } from "./document-paste-sanitizer"

describe("sanitizeDocumentPasteHTML", () => {
  it("保留支持的表格、待办、分割线与 HTTPS 图片", () => {
    const result = parse(
      sanitizeDocumentPasteHTML(`
      <ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>完成</p></li></ul>
      <table><tbody><tr><td colspan="2" colwidth="120,130">单元格</td></tr></tbody></table>
      <hr data-thickness="5" data-line-style="dotted">
      <img src="https://example.com/image.png" alt="图片">
    `),
    )
    expect(result.querySelector("li")?.getAttribute("data-checked")).toBe("true")
    expect(result.querySelector("th")?.getAttribute("colwidth")).toBe("120,130")
    expect(result.querySelector("hr")?.getAttribute("data-line-style")).toBe("dotted")
    expect(result.querySelector("figure")?.getAttribute("data-external-url")).toBe(
      "https://example.com/image.png",
    )
  })

  it("删除可执行内容、事件属性、非法链接及 HTTP/data/blob 图片", () => {
    const result = parse(
      sanitizeDocumentPasteHTML(`
      <script>alert(1)</script><iframe src="https://example.com"></iframe><svg><script /></svg>
      <form><input value="secret"></form>
      <p onclick="alert(1)"><a href="javascript:alert(1)">危险</a></p>
      <img src="http://example.com/plain.png"><img src="data:image/png;base64,AAAA"><img src="blob:test">
    `),
    )
    expect(result.querySelector("script,iframe,svg,form,input,img,figure")).toBeNull()
    expect(result.querySelector("p")?.hasAttribute("onclick")).toBe(false)
    expect(result.querySelector("a")?.hasAttribute("href")).toBe(false)
  })
})

function parse(html: string) {
  return new DOMParser().parseFromString(html, "text/html")
}
