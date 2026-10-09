import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadPurchaseOrderLineItem, purchaseOrderLineItemWhere, purchaseOrderWhere } from "@/lib/scoped-loaders"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, lineItemId } = await params
  const existing = await loadPurchaseOrderLineItem(ctx, id, lineItemId)
  if (!existing) return notFound()

  // Verified against the URL and the caller's company by the loader, so the
  // follow up queries below use this rather than the raw URL id
  const poId = existing.purchaseOrderId

  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.received !== undefined) data.received = Boolean(body.received)
  if (body.serialNumber !== undefined) data.serialNumber = body.serialNumber || null
  if (body.unitCost !== undefined) data.unitCost = Number(body.unitCost)
  if (body.quantity !== undefined) data.quantity = Number(body.quantity)
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description || null
  if (body.partNumber !== undefined) data.partNumber = body.partNumber || null
  if (body.sku !== undefined) data.sku = body.sku || null
  if (body.vendorSku !== undefined) data.vendorSku = body.vendorSku || null
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder)

  const lineItem = await prisma.pOLineItem.update({ where: purchaseOrderLineItemWhere(ctx, poId, lineItemId), data })

  // If every line item on this PO is now received, auto-advance the PO
  // itself to Received — but only forward, never overrides a manual
  // On Hold/Backordered/Cancelled status
  if (body.received !== undefined) {
    const allItems = await prisma.pOLineItem.findMany({
      where: { purchaseOrderId: poId, purchaseOrder: { companyId: ctx.companyId } },
    })
    const allReceived = allItems.every((li) => li.received)
    const po = await prisma.purchaseOrder.findUnique({ where: purchaseOrderWhere(ctx, poId) })
    if (allReceived && po && po.status === "PARTS_ORDERED") {
      await prisma.purchaseOrder.update({
        where: purchaseOrderWhere(ctx, poId),
        data: { status: "RECEIVED", receivedAt: new Date() },
      })
    }
  }

  return NextResponse.json(lineItem)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, lineItemId } = await params
  const existing = await loadPurchaseOrderLineItem(ctx, id, lineItemId)
  if (!existing) return notFound()

  await prisma.pOLineItem.delete({ where: purchaseOrderLineItemWhere(ctx, existing.purchaseOrderId, lineItemId) })

  return NextResponse.json({ deleted: true })
}
