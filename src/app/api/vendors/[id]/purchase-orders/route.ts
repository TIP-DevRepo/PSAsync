import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "vendors",
    message: "You do not have permission to view vendors",
  })
  if (response) return response

  const { id } = await params

  // Only the user's own purchase orders unless they see everyone's, the
  // same rule as the purchase order list
  const canViewAll = ctx.can("purchaseOrders.viewAll")

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { vendorId: id, companyId: ctx.companyId, ...(canViewAll ? {} : { userId: ctx.userId }) },
    include: { lineItems: { select: { unitCost: true, quantity: true } } },
    orderBy: { createdAt: "desc" },
  })

  const result = purchaseOrders.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    total: po.lineItems.reduce((sum, li) => sum + li.unitCost * li.quantity, 0),
    createdAt: po.createdAt,
  }))

  return NextResponse.json(result)
}