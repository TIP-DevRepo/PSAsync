import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewableSalesOrderWhere } from "@/lib/scoped-loaders"
import { loadRecordOpportunityPanel } from "@/lib/opportunity-quotes"

// The sales order page's Opportunity panel: the opportunity it is linked to
// (only for users who may open it) and that opportunity's other linked
// records the user may open, with the Related tab's cost rule
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.salesOrders",
    message: "You do not have permission to view sales orders",
  })
  if (response) return response

  const { id } = await params
  const salesOrder = await prisma.salesOrder.findFirst({ where: viewableSalesOrderWhere(ctx, id), select: { opportunityId: true } })
  if (!salesOrder) return notFound()

  return NextResponse.json(await loadRecordOpportunityPanel(ctx, salesOrder.opportunityId))
}
