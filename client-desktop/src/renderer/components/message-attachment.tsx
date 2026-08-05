import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import {
  Archive,
  Download,
  File,
  FileCode2,
  FileImage,
  FileText,
  LoaderCircle,
  Table2,
} from "lucide-react"
import { toast } from "sonner"

import { readTemporaryFileURLs, type ClientFileMessageBody } from "@/lib/client-data-api"
import { formatFileSize } from "@/lib/file-format"
import { downloadHostTemporaryFile } from "@/lib/desktop-host"
import { Button } from "@/components/ui/button"

type MessageAttachmentProps = {
  file: ClientFileMessageBody
}

export function MessageAttachment({ file }: MessageAttachmentProps) {
  const { t } = useLocale()
  const [downloading, setDownloading] = React.useState(false)

  async function handleDownload() {
    if (downloading) {
      return
    }

    setDownloading(true)

    try {
      if (await downloadHostTemporaryFile(file.fileId, file.name)) return
      const urls = await readTemporaryFileURLs([file.fileId])
      const readURL = urls.find((item) => item.fileId === file.fileId) ?? urls[0]

      if (!readURL) {
        throw new Error("missing read url")
      }

      triggerBrowserDownload(readURL.url, file.name)
    } catch {
      toast.error(t("attachment.downloadFailed"))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Button
      aria-disabled={downloading}
      aria-label={t("attachment.download", { name: file.name })}
      className="h-auto w-80 max-w-full justify-start gap-3 p-0 text-left font-normal hover:bg-background/40"
      disabled={downloading}
      onClick={() => void handleDownload()}
      title={t("attachment.downloadTitle")}
      type="button"
      variant="ghost"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background/50 text-muted-foreground">
        <AttachmentFileIcon fileName={file.name} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-snug font-medium">{file.name}</div>
        <div className="text-xs leading-snug text-muted-foreground">
          {formatFileSize(file.sizeBytes)}
        </div>
      </div>
      <span className="flex size-8 shrink-0 items-center justify-center">
        {downloading ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
      </span>
    </Button>
  )
}

function AttachmentFileIcon({ fileName }: { fileName: string }) {
  const extension = getFileExtension(fileName)

  if (imageExtensions.has(extension)) {
    return <FileImage className="size-5" />
  }
  if (spreadsheetExtensions.has(extension)) {
    return <Table2 className="size-5" />
  }
  if (archiveExtensions.has(extension)) {
    return <Archive className="size-5" />
  }
  if (codeExtensions.has(extension)) {
    return <FileCode2 className="size-5" />
  }
  if (textExtensions.has(extension)) {
    return <FileText className="size-5" />
  }

  return <File className="size-5" />
}

function getFileExtension(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf(".")

  if (lastDotIndex < 0 || lastDotIndex === fileName.length - 1) {
    return ""
  }

  return fileName.slice(lastDotIndex + 1).toLowerCase()
}

function triggerBrowserDownload(url: string, fileName: string) {
  const link = document.createElement("a")

  link.href = url
  link.download = fileName
  link.rel = "noopener noreferrer"
  link.target = "_blank"
  document.body.appendChild(link)
  link.click()
  link.remove()
}

const imageExtensions = new Set(["apng", "avif", "gif", "jpeg", "jpg", "png", "svg", "webp"])
const spreadsheetExtensions = new Set(["csv", "numbers", "ods", "xls", "xlsx"])
const archiveExtensions = new Set(["7z", "gz", "rar", "tar", "tgz", "zip"])
const codeExtensions = new Set([
  "c",
  "cpp",
  "css",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "php",
  "py",
  "rb",
  "rs",
  "sql",
  "swift",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
])
const textExtensions = new Set([
  "doc",
  "docx",
  "key",
  "md",
  "odp",
  "ods",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "txt",
])
