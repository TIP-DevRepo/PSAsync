import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const po = await prisma.purchaseOrder.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!po) {
    return NextResponse.json({ error: "Purchase Order not found" }, { status: 404 })
  }

  const body = await req.json()
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