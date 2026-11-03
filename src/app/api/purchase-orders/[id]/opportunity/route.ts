import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewablePurchaseOrderWhere } from "@/lib/scoped-loaders"
import { loadRecordOpportunityPanel } from "@/lib/opportunity-quotes"

// The purchase order page's Opportunity panel: the opportunity it is linked
// to (only for users who may open it) and that opportunity's other linked
// records the user may open, with the Related tab's cost rule
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.purchaseOrders",
    message: "You do not have permission to view purchase orders",
  })
  if (response) return response

  const { id } = await params
  const purchaseOrder = await prisma.purchaseOrder.findFirst({ where: viewablePurchaseOrderWhere(ctx, id), select: { opportunityId: true } })
  if (!purchaseOrder) return notFound()

  return NextResponse.json(await loadRecordOpportunityPanel(ctx, purchaseOrder.opportunityId))
}
