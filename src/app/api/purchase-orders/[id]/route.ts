import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

const VALID_STATUSES = ["DRAFT", "PARTS_ORDERED", "RECEIVED", "ON_HOLD", "BACKORDERED", "CANCELLED"]

export async function GET(
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
    include: {
      vendor: { select: { id: true, name: true, email: true } },
      user: { select: { id: true, name: true } },
      salesOrder: { select: { id: true, soNumber: true, clientId: true } },
      shipToClientRef: { select: { id: true, name: true } },
      shipToClientLocation: { select: { id: true, name: true } },
      receivingClientLocation: { select: { id: true, name: true } },
      lineItems: {
        orderBy: { sortOrder: "asc" },
        include: { catalogItem: { select: { isSerialized: true, type: true } } },
      },
      shipments: { orderBy: { createdAt: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "desc" } },
    },
  })

  if (!po) {
    return NextResponse.json({ error: "Purchase Order not found" }, { status: 404 })
  }

  return NextResponse.json(po)
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

  const existing = await prisma.purchaseOrder.findUnique({ where: { id, companyId } })
  if (!existing) {
    return NextResponse.json({ error: "Purchase Order not found" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!(await hasPermission(session.user.id, "purchaseOrders.changeStatus"))) {
      return NextResponse.json({ error: "You don't have permission to change a Purchase Order's status" }, { status: 403 })
    }
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    data.status = body.status
    if (body.status === "RECEIVED" && !existing.receivedAt) data.receivedAt = new Date()
  }

  if (body.paymentType !== undefined) data.paymentType = body.paymentType
  if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes || null
  if (body.expectedAt !== undefined) data.expectedAt = body.expectedAt ? new Date(body.expectedAt) : null
  if (body.shipToClient !== undefined) data.shipToClient = body.shipToClient
  if (body.shipContactName !== undefined) data.shipContactName = body.shipContactName || null
  if (body.shipAddress !== undefined) data.shipAddress = body.shipAddress || null
  if (body.shipAddress2 !== undefined) data.shipAddress2 = body.shipAddress2 || null
  if (body.shipCity !== undefined) data.shipCity = body.shipCity || null
  if (body.shipState !== undefined) data.shipState = body.shipState || null
  if (body.shipZip !== undefined) data.shipZip = body.shipZip || null
  if (body.shipCountry !== undefined) data.shipCountry = body.shipCountry || null

  const updated = await prisma.purchaseOrder.update({ where: { id }, data })

  return NextResponse.json(updated)
}