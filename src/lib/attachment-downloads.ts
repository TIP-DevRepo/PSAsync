import { NextResponse } from "next/server"
import { apiError, notFound, type AccessContext } from "@/lib/api-access"
import type { AttachmentKind } from "@/lib/attachment-paths"
import { loadDownloadableAttachment } from "@/lib/scoped-loaders"
import { presignedDownloadUrl } from "@/lib/uploads"
import { GENERIC_ERROR_MESSAGE, errorSummary } from "@/lib/user-error"

// The shared body of every attachment download route
// (src/app/api/files/<kind>/[attachmentId]/route.ts). The route has
// already run requireAccess with the parent page's permission; this loads
// the attachment through its parent's view check and answers 302 to a
// presigned link that works for five minutes (DOWNLOAD_LINK_SECONDS).

export const FILE_NOT_AVAILABLE_MESSAGE = "File not available"

// A stored link that isn't one of the app's objects (an old dummy link,
// another bucket): never redirected anywhere
export function fileNotAvailable() {
  return apiError(404, FILE_NOT_AVAILABLE_MESSAGE, "FILE_NOT_AVAILABLE")
}

export async function attachmentDownloadResponse(
  ctx: Pick<AccessContext, "companyId" | "userId" | "can">,
  kind: AttachmentKind,
  attachmentId: string
): Promise<NextResponse> {
  const attachment = await loadDownloadableAttachment(ctx, kind, attachmentId)
  if (!attachment) return notFound()

  let link: string | null
  try {
    link = await presignedDownloadUrl(attachment.fileUrl, attachment.prefix, attachment.fileName)
  } catch (err) {
    // Never the link, the stored URL, or the error object
    console.error(`Attachment download (${kind}) could not be signed: ${errorSummary(err)}`)
    return apiError(500, GENERIC_ERROR_MESSAGE)
  }
  if (!link) {
    console.warn(`Attachment download (${kind}): stored link is outside the uploads bucket for attachment ${attachmentId}`)
    return fileNotAvailable()
  }

  const res = NextResponse.redirect(link, 302)
  res.headers.set("Cache-Control", "no-store")
  return res
}
