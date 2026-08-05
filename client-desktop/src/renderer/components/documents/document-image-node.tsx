import * as React from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ImageIcon,
  Link2,
  Loader2,
  RotateCw,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { resolveHostResourceUrl } from "@/lib/desktop-host"
import { uploadDocumentImage } from "@/lib/document-image-api"
import { cn } from "@/lib/utils"
import { DocumentControlSeparator } from "./document-control-separator"
import {
  isLoadableDocumentExternalImage,
  normalizeDocumentImageAttributes,
} from "./document-image-attributes"
import { DocumentImageResolutionContext } from "./document-image-resolution"

export function DocumentImageNodeView({ editor, node, updateAttributes }: NodeViewProps) {
  const attributes = normalizeDocumentImageAttributes(node.attrs)
  const editable = editor?.isEditable ?? true
  const { refresh, resolutions } = React.useContext(DocumentImageResolutionContext)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const mounted = React.useRef(true)
  const [uploading, setUploading] = React.useState(false)
  const [onlineUrl, setOnlineUrl] = React.useState("")
  const [onlineUrlOpen, setOnlineUrlOpen] = React.useState(false)
  const resolution = attributes.fileId ? resolutions.get(attributes.fileId) : null
  const externalAllowed = isLoadableDocumentExternalImage(attributes.externalUrl)
  const source = externalAllowed
    ? attributes.externalUrl
    : resolution?.status === "ready"
      ? resolution.url
      : null
  const sourceKey = attributes.externalUrl
    ? `external:${attributes.externalUrl}`
    : `file:${attributes.fileId ?? ""}`
  const [failureState, setFailureState] = React.useState({ count: 0, sourceKey })
  const loadFailures = failureState.sourceKey === sourceKey ? failureState.count : 0

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function setLoadFailures(count: number) {
    setFailureState({ count, sourceKey })
  }

  function handleImageError() {
    if (attributes.externalUrl) {
      setLoadFailures(2)
      return
    }
    if (loadFailures === 0 && attributes.fileId) {
      setLoadFailures(1)
      refresh(attributes.fileId)
      return
    }
    setLoadFailures(2)
  }

  async function upload(file?: File) {
    if (!editable || !file || uploading) return
    setUploading(true)
    try {
      const result = await uploadDocumentImage(file)
      if (mounted.current) {
        updateAttributes({ alt: file.name, externalUrl: null, fileId: result.fileId })
        setLoadFailures(0)
      }
    } catch (error) {
      if (mounted.current) toast.error(error instanceof Error ? error.message : "上传图片失败")
    } finally {
      if (mounted.current) setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function submitOnline(event: React.FormEvent) {
    event.preventDefault()
    if (!editable) return
    try {
      const parsed = new URL(onlineUrl.trim())
      if (parsed.protocol !== "https:") throw new Error("在线图片地址必须使用 HTTPS")
      updateAttributes({
        alt: attributes.alt || "在线图片",
        externalUrl: parsed.toString(),
        fileId: null,
      })
      setOnlineUrl("")
      setOnlineUrlOpen(false)
      setLoadFailures(0)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片地址格式错误")
    }
  }

  const imageReady = Boolean(source && loadFailures < 2)
  const imageLoading = Boolean(attributes.fileId && resolution?.status === "loading")
  const resolvedSource = source ? resolveHostResourceUrl(source) : ""

  return (
    <NodeViewWrapper className="document-image-node">
      <input
        accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
        aria-label="上传图片文件"
        className="sr-only"
        disabled={!editable}
        onChange={(event) => void upload(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
      <Popover>
        <PopoverTrigger asChild>
          <div
            aria-disabled={!editable}
            aria-label="设置图片"
            className="document-image-node__body"
            contentEditable={false}
            role="button"
            tabIndex={editable ? 0 : -1}
            onClickCapture={(event) => {
              if (!editable) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
            onKeyDown={(event) => {
              if (!editable) {
                event.preventDefault()
                event.stopPropagation()
                return
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                event.currentTarget.click()
              }
            }}
          >
            {imageReady ? (
              <img
                alt={attributes.alt}
                className="document-image-node__image"
                draggable={false}
                onError={handleImageError}
                onLoad={() => setLoadFailures(0)}
                src={resolvedSource}
                style={{
                  marginLeft: attributes.alignment === "left" ? 0 : "auto",
                  marginRight: attributes.alignment === "right" ? 0 : "auto",
                  width: `${attributes.width}%`,
                }}
              />
            ) : imageLoading ? (
              <div className="document-image-node__placeholder">
                <span className="document-image-node__placeholder-icon">
                  <Loader2 className="animate-spin" />
                </span>
                <span>正在加载图片</span>
              </div>
            ) : (
              <div className="document-image-node__placeholder">
                <span className="document-image-node__placeholder-icon">
                  {uploading ? <Loader2 className="animate-spin" /> : <ImageIcon />}
                </span>
                <span>
                  {attributes.externalUrl?.toLowerCase().startsWith("http:")
                    ? "Desktop 不加载 HTTP 图片"
                    : uploading
                      ? "正在上传图片"
                      : attributes.fileId || attributes.externalUrl
                        ? "图片已失效或加载失败"
                        : "添加一张图片"}
                </span>
                {attributes.fileId && !uploading && (
                  <Button
                    onClick={(event) => {
                      event.stopPropagation()
                      const fileId = attributes.fileId
                      if (!fileId) return
                      setLoadFailures(0)
                      refresh(fileId)
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RotateCw />
                    重新加载
                  </Button>
                )}
              </div>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          className="w-auto p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="top"
        >
          <DocumentImageControls
            alignment={attributes.alignment}
            alt={attributes.alt}
            onlineUrl={onlineUrl}
            onlineUrlOpen={onlineUrlOpen}
            onAlignmentChange={(alignment) => {
              if (editable) updateAttributes({ alignment })
            }}
            onAltChange={(alt) => {
              if (editable) updateAttributes({ alt })
            }}
            onOnlineUrlChange={setOnlineUrl}
            onOnlineUrlOpenChange={setOnlineUrlOpen}
            onOnlineUrlSubmit={submitOnline}
            onUpload={() => inputRef.current?.click()}
            onWidthChange={(width) => {
              if (editable) updateAttributes({ width })
            }}
            editable={editable}
            uploading={uploading}
            width={attributes.width}
          />
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  )
}

function DocumentImageControls({
  alignment,
  alt,
  editable,
  onlineUrl,
  onlineUrlOpen,
  onAlignmentChange,
  onAltChange,
  onOnlineUrlChange,
  onOnlineUrlOpenChange,
  onOnlineUrlSubmit,
  onUpload,
  onWidthChange,
  uploading,
  width,
}: {
  alignment: "center" | "left" | "right"
  alt: string
  editable: boolean
  onlineUrl: string
  onlineUrlOpen: boolean
  onAlignmentChange: (alignment: "center" | "left" | "right") => void
  onAltChange: (alt: string) => void
  onOnlineUrlChange: (url: string) => void
  onOnlineUrlOpenChange: (open: boolean) => void
  onOnlineUrlSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onUpload: () => void
  onWidthChange: (width: number) => void
  uploading: boolean
  width: number
}) {
  const alignments = [
    { icon: AlignLeft, label: "左对齐", value: "left" },
    { icon: AlignCenter, label: "居中对齐", value: "center" },
    { icon: AlignRight, label: "右对齐", value: "right" },
  ] as const

  return (
    <div
      className="flex min-h-10 w-max flex-wrap items-center justify-between gap-3"
      contentEditable={false}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          {alignments.map((item) => (
            <Button
              aria-label={item.label}
              aria-pressed={alignment === item.value}
              className={cn(alignment === item.value && "bg-muted")}
              key={item.value}
              disabled={!editable}
              onClick={() => onAlignmentChange(item.value)}
              size="icon-xs"
              title={item.label}
              type="button"
              variant="ghost"
            >
              <item.icon />
            </Button>
          ))}
        </div>
        <DocumentControlSeparator />
        <Slider
          aria-label="图片宽度"
          className="w-28"
          max={100}
          min={20}
          disabled={!editable}
          onValueChange={(value) => onWidthChange(value[0] ?? width)}
          step={5}
          value={[width]}
        />
        <span className="w-10 text-right text-xs text-muted-foreground">{width}%</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          disabled={!editable || uploading}
          onClick={onUpload}
          size="sm"
          type="button"
          variant="ghost"
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          {uploading ? "正在上传" : "上传图片"}
        </Button>
        <Popover onOpenChange={onOnlineUrlOpenChange} open={onlineUrlOpen}>
          <PopoverTrigger asChild>
            <Button disabled={!editable || uploading} size="sm" type="button" variant="ghost">
              <Link2 />
              在线图片
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-3">
            <form className="flex items-center gap-2" onSubmit={onOnlineUrlSubmit}>
              <Input
                aria-label="在线图片地址"
                autoFocus
                onChange={(event) => onOnlineUrlChange(event.target.value)}
                placeholder="https://example.com/image.png"
                type="url"
                value={onlineUrl}
              />
              <Button size="sm" type="submit">
                插入
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      <Input
        aria-label="图片替代文本"
        className="w-full"
        disabled={!editable}
        maxLength={500}
        onChange={(event) => onAltChange(event.target.value)}
        placeholder="图片替代文本"
        value={alt}
      />
    </div>
  )
}
