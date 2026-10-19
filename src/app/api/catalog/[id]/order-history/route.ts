import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "catalog",
    message: "You do not have permission to view the catalog",
  })
  if (response) return response

  const { id } = await params

  // Only the user's own sales orders unless they see everyone's, the same
  // rule as the sales order list
  const canViewAll = ctx.can("salesOrders.viewAll")

  const lineItems = await prisma.sOLineItem.findMany({
    where: {
      catalogItemId: id,
      salesOrder: { companyId: ctx.companyId, ...(canViewAll ? {} : { userId: ctx.userId }) },
    },
    include: {
      salesOrder: {
        select: {
          id: true,
          soNumber: true,
          status: true,
          createdAt: true,
          client: { select: { name: true } },
        },
      },
    },
    orderBy: { salesOrder: { createdAt: "desc" } },
  })

  const result = lineItems.map((li) => ({
    id: li.id,
    soId: li.salesOrder.id,
    soNumber: li.salesOrder.soNumber,
    status: li.salesOrder.status,
    clientName: li.salesOrder.client.name,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    createdAt: li.salesOrder.createdAt,
  }))

  return NextResponse.json(result)
}