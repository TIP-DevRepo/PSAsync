// Where the browser downloads an attachment: a PSAsync route that checks
// the user may view the record the attachment belongs to, then redirects to
// a short lived presigned link (src/lib/attachment-downloads.ts). Stored
// attachment URLs (fileUrl) never reach the browser; every API response
// that returns an attachment maps it with withDownloadUrl. No server
// imports, so pages and components can use it.

export const ATTACHMENT_KINDS = ["vendor", "sales-order", "purchase-order", "inventory-asset", "opportunity"] as const

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

// GET /api/files/<kind>/<attachment id>
export function attachmentDownloadPath(kind: AttachmentKind, attachmentId: string): string {
  return `/api/files/${kind}/${encodeURIComponent(attachmentId)}`
}

// An attachment row as the browser gets it: the stored fileUrl replaced by
// downloadUrl, the download route
export function withDownloadUrl<T extends { id: string; fileUrl?: string }>(
  kind: AttachmentKind,
  attachment: T
): Omit<T, "fileUrl"> & { downloadUrl: string } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fileUrl, ...rest } = attachment
  return { ...rest, downloadUrl: attachmentDownloadPath(kind, attachment.id) }
}
