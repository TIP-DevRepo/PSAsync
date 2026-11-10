"use client"

import { useCallback, useEffect, useState } from "react"
import { FileUploadZone } from "@/components/attachments/FileUploadZone"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface Attachment {
  id: string
  fileName: string
  // The download route (src/lib/attachment-paths.ts), never a bucket URL
  downloadUrl: string
  fileSize: number | null
  createdAt: string
}

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// A record's Attachments tab (an opportunity or a ticket): its files and
// the shared FileUploadZone (ATTACHMENT profile, so the same file types and
// size checks), with Remove only for users who may edit the record.
// attachmentsUrl is the record's attachments route (an attachment's own
// route is attachmentsUrl/id). onChanged runs after an upload or a removal
// (each is recorded on the timeline).
export function RecordAttachments({
  attachmentsUrl,
  recordNoun,
  canEdit,
  onChanged,
}: {
  attachmentsUrl: string
  // "opportunity" or "ticket", for the remove confirmation
  recordNoun: string
  canEdit: boolean
  onChanged?: () => void
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    fetch(attachmentsUrl)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setAttachments(data)
        setLoaded(true)
      })
  }, [attachmentsUrl])

  useEffect(() => {
    load()
  }, [load])

  const handleUploaded = useCallback(() => {
    load()
    onChanged?.()
  }, [load, onChanged])

  async function handleRemove(attachment: Attachment) {
    const confirmed = await confirmDialog({
      title: `Remove ${attachment.fileName}?`,
      description: `The file is deleted from this ${recordNoun}. This can't be undone.`,
      confirmLabel: "Remove",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`${attachmentsUrl}/${attachment.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Attachment removed")
      onChanged?.()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error("Couldn't remove the attachment", data.error)
    }
    load()
  }

  return (
    <section aria-labelledby="record-attachments-heading" className="space-y-3 rounded-card border border-border bg-card p-4">
      <h2 id="record-attachments-heading" className="text-sm font-semibold text-foreground">
        Attachments
      </h2>
      {canEdit && <FileUploadZone uploadUrl={attachmentsUrl} onUploaded={handleUploaded} />}
      <div className="space-y-2">
        {loaded && attachments.length === 0 && <p className="text-sm text-muted-foreground">No files attached yet.</p>}
        {attachments.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
            <a href={a.downloadUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-acc-ink hover:underline" title={a.fileName}>
              {a.fileName}
            </a>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-muted-foreground">{fileSizeLabel(a.fileSize)}</span>
              {canEdit && (
                <button onClick={() => handleRemove(a)} className="text-xs text-danger hover:underline">
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
