import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { RecurringInterval } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"
import { assertRefs, loadSalesOrder } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const so = await loadSalesOrder(ctx, id)
  if (!so) {
    return NextResponse.json({ error: "Sales Order not found" }, { status: 404 })
  }

  const body = await req.json()

  if (body.recurringInterval && !isEnumValue(RecurringInterval, body.recurringInterval)) {
    return apiError(400, "Invalid recurring interval")
  }
  const invalid = await assertRefs(ctx, { catalogItemId: body.catalogItemId, vendorId: body.vendorId })
  if (invalid) return invalid

  // Sort order is scoped to whatever group this item lands in — the
  // top-level list, or a specific bundle's children — so a new item
  // always lands at the end of the group it's actually being added to.
  const siblingCount = await prisma.sOLineItem.count({
    where: { salesOrderId: id, bundleName: body.bundleName ?? null },
  })

  const lineItem = await prisma.sOLineItem.create({
    data: {
      salesOrderId: id,
      catalogItemId: body.catalogItemId || null,
      vendorId: body.vendorId || null,
      name: body.name,
      description: body.description || null,
      partNumber: body.partNumber || null,
      sku: body.sku || null,
      vendorSku: body.vendorSku || null,
      quantity: Number(body.quantity) || 1,
      unitPrice: Number(body.unitPrice) || 0,
      cost: Number(body.cost) || 0,
      discount: Number(body.discount) || 0,
      taxable: body.taxable ?? true,
      isRecurring: body.isRecurring ?? false,
      recurringInterval: body.recurringInterval || null,
      bundleName: body.bundleName || null,
      bundleDisplayMode: body.bundleDisplayMode || null,
      isBundleHeader: body.isBundleHeader ?? false,
      sortOrder: siblingCount,
    },
    include: { vendor: { select: { id: true, name: true } } },
  })

  return NextResponse.json(lineItem)
}