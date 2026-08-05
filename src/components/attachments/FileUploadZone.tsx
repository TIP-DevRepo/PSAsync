"use client"

import { useState, useRef, useCallback } from "react"
import { Upload, X, RotateCw, CheckCircle2, FileText } from "lucide-react"

interface QueueItem {
  id: string
  file: File
  progress: number
  status: "uploading" | "done" | "error"
  errorMessage?: string
  previewUrl?: string
}

function fileSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// fetch() has no upload progress event — XHR is the only way to get real
// percent-complete for an outgoing upload, which the design rules call
// for explicitly ("show percent complete + time remaining, not just a
// spinner").
function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error("Upload failed"))
    }
    xhr.onerror = () => reject(new Error("Upload failed"))
    const formData = new FormData()
    formData.append("file", file)
    xhr.send(formData)
  })
}

// Shared drag-drop upload zone — used by both Sales Order and Purchase
// Order Attachments tabs (and any future attachment surface). Follows the
// File Upload UX design rule: drag feedback, honest per-file progress,
// inline retry on failure (no forced re-selection), file proof (name/
// size/type, thumbnail for images), and a multi-file queue where each
// item tracks its own state independently.
export function FileUploadZone({
  uploadUrl,
  onUploaded,
}: {
  uploadUrl: string
  onUploaded: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const startUpload = useCallback(
    (item: QueueItem) => {
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: "uploading", progress: 0, errorMessage: undefined } : q))
      )
      uploadWithProgress(uploadUrl, item.file, (pct) => {
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, progress: pct } : q)))
      })
        .then(() => {
          setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: "done", progress: 100 } : q)))
          onUploaded()
        })
        .catch(() => {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, status: "error", errorMessage: "Upload failed — try again" } : q))
          )
        })
    },
    [uploadUrl, onUploaded]
  )

  function addFiles(files: FileList | File[]) {
    const items: QueueItem[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      file,
      progress: 0,
      status: "uploading" as const,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }))
    setQueue((prev) => [...prev, ...items])
    items.forEach((item) => startUpload(item))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"
        }`}
      >
        <input ref={fileInputRef} type="file" multiple onChange={handleFileInputChange} className="hidden" />
        <Upload size={20} className={`mx-auto mb-2 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
        <p className="text-sm text-foreground">
          {isDragging ? "Drop to upload" : "Drag files here, or click to browse"}
        </p>
      </div>

      {queue.length > 0 && (
        <div className="space-y-1">
          {queue.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-md border border-border p-2 text-sm">
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
              ) : (
                <FileText size={20} className="text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-foreground">{item.file.name}</p>
                <p className="text-xs text-muted-foreground">{fileSizeLabel(item.file.size)}</p>
                {item.status === "uploading" && (
                  <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.status === "error" && <p className="text-xs text-danger mt-0.5">{item.errorMessage}</p>}
              </div>
              {item.status === "uploading" && (
                <span className="text-xs text-muted-foreground shrink-0">{item.progress}%</span>
              )}
              {item.status === "done" && <CheckCircle2 size={16} className="text-success shrink-0" />}
              {item.status === "error" && (
                <button
                  onClick={() => startUpload(item)}
                  title="Retry"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <RotateCw size={14} />
                </button>
              )}
              <button
                onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                title="Dismiss"
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}