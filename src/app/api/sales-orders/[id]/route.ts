import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { notifySalesOrderStatusChange } from "@/lib/notify"

const VALID_STATUSES = [
  "DRAFT",
  "READY_TO_INVOICE",
  "INVOICED",
  "READY_TO_ORDER",
  "PARTS_ORDERED",
  "READY_TO_CLOSEOUT",
  "CLOSED",
]

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const salesOrder = await prisma.salesOrder.findUnique({
    where: { id, companyId: session.user.companyId },
    include: {
      client: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
      quote: { select: { id: true, quoteNumber: true } },
      lineItems: {
        orderBy: { sortOrder: "asc" },
        include: {
          fulfillingPOLineItems: { select: { id: true } },
          vendor: { select: { id: true, name: true } },
        },
      },
      purchaseOrders: {
        include: {
          vendor: { select: { name: true } },
          lineItems: { orderBy: { sortOrder: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!salesOrder) {
    return NextResponse.json({ error: "Sales Order not found" }, { status: 404 })
  }

  const canViewAll = await hasPermission(session.user.id, "salesOrders.viewAll")
  if (!canViewAll && salesOrder.userId !== session.user.id) {
    return NextResponse.json({ error: "Sales Order not found" }, { status: 404 })
  }

  return NextResponse.json(salesOrder)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const companyId = session.user.companyId
  const body = await req.json()

  const existing = await prisma.salesOrder.findUnique({ where: { id, companyId } })
  if (!existing) {
    return NextResponse.json({ error: "Sales Order not found" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!(await hasPermission(session.user.id, "salesOrders.changeStatus"))) {
      return NextResponse.json({ error: "You don't have permission to change a Sales Order's status" }, { status: 403 })
    }
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    data.status = body.status
  }

  if (body.clientPoNumber !== undefined) data.clientPoNumber = body.clientPoNumber || null
  if (body.paymentTerms !== undefined) data.paymentTerms = body.paymentTerms || null
  if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes || null
  if (body.clientNotes !== undefined) data.clientNotes = body.clientNotes || null
  if (body.billContactName !== undefined) data.billContactName = body.billContactName || null
  if (body.billAddress !== undefined) data.billAddress = body.billAddress || null
  if (body.billAddress2 !== undefined) data.billAddress2 = body.billAddress2 || null
  if (body.billCity !== undefined) data.billCity = body.billCity || null
  if (body.billState !== undefined) data.billState = body.billState || null
  if (body.billZip !== undefined) data.billZip = body.billZip || null
  if (body.billCountry !== undefined) data.billCountry = body.billCountry || null
  if (body.shipContactName !== undefined) data.shipContactName = body.shipContactName || null
  if (body.shipAddress !== undefined) data.shipAddress = body.shipAddress || null
  if (body.shipAddress2 !== undefined) data.shipAddress2 = body.shipAddress2 || null
  if (body.shipCity !== undefined) data.shipCity = body.shipCity || null
  if (body.shipState !== undefined) data.shipState = body.shipState || null
  if (body.shipZip !== undefined) data.shipZip = body.shipZip || null
  if (body.shipCountry !== undefined) data.shipCountry = body.shipCountry || null

  const updated = await prisma.salesOrder.update({ where: { id }, data })

  // Fire notifications for the 3 statuses that have a configured notify rule
  if (body.status && ["READY_TO_INVOICE", "READY_TO_ORDER", "READY_TO_CLOSEOUT"].includes(body.status)) {
    notifySalesOrderStatusChange(id, body.status).catch((err) =>
      console.error("notifySalesOrderStatusChange failed:", err)
    )
  }

  return NextResponse.json(updated)
}