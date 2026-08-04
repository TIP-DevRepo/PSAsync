import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const canViewAll = await hasPermission(session.user.id, "salesOrders.viewAll")

  const salesOrders = await prisma.salesOrder.findMany({
    where: {
      companyId: session.user.companyId,
      ...(canViewAll ? {} : { userId: session.user.id }),
    },
    include: {
      client: { select: { name: true } },
      user: { select: { id: true, name: true } },
      lineItems: { select: { unitPrice: true, quantity: true, discount: true, isTextBlock: true } },
      purchaseOrders: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  const result = salesOrders.map((so) => {
    const total = so.lineItems
      .filter((li) => !li.isTextBlock)
      .reduce((sum, li) => sum + li.unitPrice * li.quantity * (1 - li.discount / 100), 0)

    return {
      id: so.id,
      soNumber: so.soNumber,
      status: so.status,
      clientPoNumber: so.clientPoNumber,
      clientName: so.client.name,
      owner: so.user,
      total,
      poCount: so.purchaseOrders.length,
      createdAt: so.createdAt,
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()

  if (!body.clientId) {
    return NextResponse.json({ error: "A client is required" }, { status: 400 })
  }

  const companyId = session.user.companyId

  const settings = await prisma.companySettings.findUnique({ where: { companyId } })
  const prefix = settings?.soPrefix ?? "SO"

  const year = new Date().getFullYear()
  const existingCount = await prisma.salesOrder.count({ where: { companyId } })
  const soNumber = `${prefix}-${year}-${String(existingCount + 1).padStart(4, "0")}`

  const salesOrder = await prisma.salesOrder.create({
    data: {
      companyId,
      clientId: body.clientId,
      userId: session.user.id,
      soNumber,
      clientPoNumber: body.clientPoNumber || null,
      paymentTerms: body.paymentTerms || null,
      internalNotes: body.internalNotes || null,
      billContactName: body.billContactName || null,
      billAddress: body.billAddress || null,
      billAddress2: body.billAddress2 || null,
      billCity: body.billCity || null,
      billState: body.billState || null,
      billZip: body.billZip || null,
      billCountry: body.billCountry || null,
      shipContactName: body.shipContactName || null,
      shipAddress: body.shipAddress || null,
      shipAddress2: body.shipAddress2 || null,
      shipCity: body.shipCity || null,
      shipState: body.shipState || null,
      shipZip: body.shipZip || null,
      shipCountry: body.shipCountry || null,
    },
  })

  return NextResponse.json(salesOrder)
}