import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableOpportunity } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { loadOpportunityRelated } from "@/lib/opportunity-related"

// The opportunity page's Related panel: its linked quotes, sales orders,
// and purchase orders, each list holding only what the user may open under
// that record's own view rules (see loadOpportunityRelated)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.opportunities",
    message: "You do not have permission to view opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await loadViewableOpportunity(ctx, id)
  if (!opportunity) return notFound()

  return NextResponse.json(await loadOpportunityRelated(prisma, ctx, opportunity.id))
}
