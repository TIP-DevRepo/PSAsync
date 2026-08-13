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

  const lineItems = await prisma.sOLineItem.findMany({
    where: {
      catalogItemId: id,
      salesOrder: { companyId: session.user.companyId },
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