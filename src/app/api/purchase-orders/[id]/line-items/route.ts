import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { assertRefs, loadPurchaseOrder } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const po = await loadPurchaseOrder(ctx, id)
  if (!po) {
    return NextResponse.json({ error: "Purchase Order not found" }, { status: 404 })
  }

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
      unitCost: Number(body.unitCost) || 0,
      sortOrder: siblingCount,
    },
  })

  return NextResponse.json(lineItem)
}