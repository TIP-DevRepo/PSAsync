import { NextRequest } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { attachmentDownloadResponse } from "@/lib/attachment-downloads"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"

// Downloads one ticket attachment: the ticket view check (never a deleted
// ticket), then a 302 to a five minute presigned link
// (src/lib/attachment-downloads.ts)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.tickets",
    message: "You do not have permission to view tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { attachmentId } = await params
  return attachmentDownloadResponse(ctx, "ticket", attachmentId)
}
