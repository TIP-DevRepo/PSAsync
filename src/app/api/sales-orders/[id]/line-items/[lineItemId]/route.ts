import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { lineItemId } = await params
  const body = await req.json()

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description || null
  if (body.partNumber !== undefined) data.partNumber = body.partNumber || null
  if (body.sku !== undefined) data.sku = body.sku || null
  if (body.vendorSku !== undefined) data.vendorSku = body.vendorSku || null
  if (body.vendorId !== undefined) data.vendorId = body.vendorId || null
  if (body.quantity !== undefined) data.quantity = Number(body.quantity)
  if (body.unitPrice !== undefined) data.unitPrice = Number(body.unitPrice)
  if (body.cost !== undefined) data.cost = Number(body.cost)
  if (body.discount !== undefined) data.discount = Number(body.discount)
  if (body.taxable !== undefined) data.taxable = body.taxable
  if (body.isRecurring !== undefined) data.isRecurring = body.isRecurring
  if (body.recurringInterval !== undefined) data.recurringInterval = body.recurringInterval || null
  if (body.bundleName !== undefined) data.bundleName = body.bundleName || null
  if (body.bundleDisplayMode !== undefined) data.bundleDisplayMode = body.bundleDisplayMode || null
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder)

  const lineItem = await prisma.sOLineItem.update({
    where: { id: lineItemId },
    data,
    include: { vendor: { select: { id: true, name: true } } },
  })

  return NextResponse.json(lineItem)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { lineItemId } = await params

  const existing = await prisma.sOLineItem.findUnique({ where: { id: lineItemId } })
  if (!existing) {
    return NextResponse.json({ error: "Line item not found" }, { status: 404 })
  }

  // Deleting a bundle header shouldn't take its contents with it — unbundle
  // the children first so they survive as regular top-level items.
  if (existing.isBundleHeader && existing.bundleName) {
    await prisma.sOLineItem.updateMany({
      where: { salesOrderId: existing.salesOrderId, bundleName: existing.bundleName, isBundleHeader: false },
      data: { bundleName: null },
    })
  }

  await prisma.sOLineItem.delete({ where: { id: lineItemId } })

  return NextResponse.json({ deleted: true })
}