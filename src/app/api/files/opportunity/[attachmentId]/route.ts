import { NextRequest } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { attachmentDownloadResponse } from "@/lib/attachment-downloads"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"

// Downloads one opportunity attachment: the parent's view check, then a 302 to a
// five minute presigned link (src/lib/attachment-downloads.ts)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.opportunities",
    message: "You do not have permission to view opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { attachmentId } = await params
  return attachmentDownloadResponse(ctx, "opportunity", attachmentId)
}
