"use client"

import { useCallback, useEffect, useState } from "react"
import { FileUploadZone } from "@/components/attachments/FileUploadZone"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface Attachment {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number | null
  createdAt: string
}

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// The sales order Attachments tab's list and upload zone, for an
// opportunity: the shared FileUploadZone (ATTACHMENT profile, so the same
// file types and size checks), and Remove only with opportunities.edit.
// onChanged runs after an upload or a removal (each is recorded on the
// timeline).
export function OpportunityAttachments({
  opportunityId,
  canEdit,
  onChanged,
}: {
  opportunityId: string
  canEdit: boolean
  onChanged?: () => void
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/opportunities/${opportunityId}/attachments`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setAttachments(data)
        setLoaded(true)
      })
  }, [opportunityId])

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
      description: "The file is deleted from this opportunity. This can't be undone.",
      confirmLabel: "Remove",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/opportunities/${opportunityId}/attachments/${attachment.id}`, { method: "DELETE" })
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
    <section aria-labelledby="opportunity-attachments-heading" className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 id="opportunity-attachments-heading" className="text-sm font-semibold text-foreground">
        Attachments
      </h2>
      {canEdit && <FileUploadZone uploadUrl={`/api/opportunities/${opportunityId}/attachments`} onUploaded={handleUploaded} />}
      <div className="space-y-2">
        {loaded && attachments.length === 0 && <p className="text-sm text-muted-foreground">No files attached yet.</p>}
        {attachments.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
            <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-primary hover:underline" title={a.fileName}>
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
