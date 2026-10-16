import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, loadViewablePurchaseOrder } from "@/lib/scoped-loaders"
import { newLineItemCost } from "@/lib/line-item-cost"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "purchaseOrders.edit",
    message: "You do not have permission to edit purchase orders",
  })
  if (response) return response

  const { id } = await params

  const po = await loadViewablePurchaseOrder(ctx, id)
  if (!po) return notFound()

  const body = await req.json()

  const invalid = await assertRefs(ctx, { catalogItemId: body.catalogItemId })
  if (invalid) return invalid
  const siblingCount = await prisma.pOLineItem.count({ where: { purchaseOrderId: id } })

  const lineItem = await prisma.pOLineItem.create({
    data: {
      purchaseOrderId: id,
      catalogItemId: body.catalogItemId || null,
      name: body.name,
      description: body.description || null,
      partNumber: body.partNumber || null,
      sku: body.sku || null,
      vendorSku: body.vendorSku || null,
      quantity: Number(body.quantity) || 1,
      unitCost: await newLineItemCost(ctx, body.catalogItemId, body.unitCost),
      sortOrder: siblingCount,
    },
  })

  return NextResponse.json(lineItem)
}