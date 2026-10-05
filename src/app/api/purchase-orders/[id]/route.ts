import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

const VALID_STATUSES = ["DRAFT", "PARTS_ORDERED", "RECEIVED", "ON_HOLD", "BACKORDERED", "CANCELLED"]
const VALID_PAYMENT_TYPES = ["Due on Receipt", "Net15", "Net30", "Net45", "Net60", "Prepaid", "Credit Card"]

// Payment and shipping details stop being editable once the order has
// actually been received, same line the existing Delete block already
// draws, so there's one consistent definition of "too far along to change"
// rather than two different rules for Delete and Edit.
const EDIT_GATED_FIELDS = [
  "paymentType",
  "shipContactName",
  "shipAddress",
  "shipAddress2",
  "shipCity",
  "shipState",
  "shipZip",
  "shipCountry",
  "shipClientLocationId",
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
        include: {
          catalogItem: { select: { isSerialized: true, type: true } },
          polineItemSerials: { select: { id: true, serialNumber: true, assetId: true } },
        },
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

  const touchesGatedField = EDIT_GATED_FIELDS.some((field) => body[field] !== undefined)
  if (touchesGatedField) {
    if (!(await hasPermission(session.user.id, "purchaseOrders.edit"))) {
      return NextResponse.json({ error: "You don't have permission to edit this purchase order" }, { status: 403 })
    }
    const receivedLineItemCount = await prisma.pOLineItem.count({ where: { purchaseOrderId: id, received: true } })
    if (existing.status === "RECEIVED" || receivedLineItemCount > 0) {
      return NextResponse.json(
        { error: "This purchase order has already been received. Payment and shipping details can no longer be edited." },
        { status: 409 }
      )
    }
  }

  if (body.paymentType !== undefined) {
    if (!VALID_PAYMENT_TYPES.includes(body.paymentType)) {
      return NextResponse.json({ error: "Invalid payment type" }, { status: 400 })
    }
    data.paymentType = body.paymentType
  }
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

  if (body.shipClientLocationId !== undefined) {
    if (body.shipClientLocationId) {
      if (!existing.shipToClientId) {
        return NextResponse.json({ error: "This purchase order has no ship-to client to pick a location from" }, { status: 400 })
      }
      const location = await prisma.clientLocation.findFirst({
        where: { id: body.shipClientLocationId, clientId: existing.shipToClientId },
      })
      if (!location) {
        return NextResponse.json({ error: "Shipping location not found for this client" }, { status: 404 })
      }
      data.shipToClientLocationId = location.id
    } else {
      data.shipToClientLocationId = null
    }
  }

  const updated = await prisma.purchaseOrder.update({ where: { id }, data })

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "purchaseOrders.delete"))) {
    return NextResponse.json({ error: "You don't have permission to delete purchase orders" }, { status: 403 })
  }

  const { id } = await params

  const po = await prisma.purchaseOrder.findUnique({
    where: { id, companyId: session.user.companyId },
    include: {
      lineItems: { include: { polineItemSerials: { select: { id: true } } } },
    },
  })

  if (!po) {
    return NextResponse.json({ error: "Purchase Order not found" }, { status: 404 })
  }

  const hasReceivedSerials = po.lineItems.some((li) => li.polineItemSerials.length > 0)
  if (hasReceivedSerials || po.status === "RECEIVED") {
    return NextResponse.json(
      { error: "This purchase order has already been received and has inventory tracked against it. It can't be deleted." },
      { status: 409 }
    )
  }

  await prisma.purchaseOrder.delete({ where: { id } })

  return NextResponse.json({ deleted: true })
}