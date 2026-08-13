import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { vendorId: id, companyId: session.user.companyId },
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