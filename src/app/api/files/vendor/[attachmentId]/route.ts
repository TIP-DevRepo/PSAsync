import { NextRequest } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { attachmentDownloadResponse } from "@/lib/attachment-downloads"

// Downloads one vendor attachment: the parent's view check, then a 302 to a
// five minute presigned link (src/lib/attachment-downloads.ts)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "vendors",
    message: "You do not have permission to view vendors",
  })
  if (response) return response

  const { attachmentId } = await params
  return attachmentDownloadResponse(ctx, "vendor", attachmentId)
}
