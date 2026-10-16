import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { purchaseOrderWhere, viewablePurchaseOrderWhere } from "@/lib/scoped-loaders"

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

// Every field other than status needs purchaseOrders.edit
const EDIT_FIELDS = [...EDIT_GATED_FIELDS, "internalNotes", "expectedAt", "shipToClient"]

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.purchaseOrders",
    message: "You do not have permission to view purchase orders",
  })
  if (response) return response

  const { id } = await params

  const po = await prisma.purchaseOrder.findFirst({
    where: viewablePurchaseOrderWhere(ctx, id),
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

  if (!po) return notFound()

  return NextResponse.json(po)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Status needs purchaseOrders.changeStatus and every other field needs
  // purchaseOrders.edit, checked per field below once the body is read
  const { ctx, response } = await requireAccess({
    permission: ["purchaseOrders.edit", "purchaseOrders.changeStatus"],
    message: "You do not have permission to edit purchase orders",
  })
  if (response) return response

  const { id } = await params

  const existing = await prisma.purchaseOrder.findFirst({ where: viewablePurchaseOrderWhere(ctx, id) })
  if (!existing) return notFound()

  const body = await req.json()

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!ctx.can("purchaseOrders.changeStatus")) {
      return apiError(403, "You do not have permission to change a purchase order's status", "FORBIDDEN")
    }
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    data.status = body.status
    if (body.status === "RECEIVED" && !existing.receivedAt) data.receivedAt = new Date()
  }

  if (EDIT_FIELDS.some((field) => body[field] !== undefined) && !ctx.can("purchaseOrders.edit")) {
    return apiError(403, "You do not have permission to edit purchase orders", "FORBIDDEN")
  }

  const touchesGatedField = EDIT_GATED_FIELDS.some((field) => body[field] !== undefined)
  if (touchesGatedField) {
    const receivedLineItemCount = await prisma.pOLineItem.count({
      where: { purchaseOrderId: existing.id, received: true },
    })
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

  const updated = await prisma.purchaseOrder.update({ where: purchaseOrderWhere(ctx, existing.id), data })

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "purchaseOrders.delete",
    message: "You do not have permission to delete purchase orders",
  })
  if (response) return response

  const { id } = await params

  const po = await prisma.purchaseOrder.findFirst({
    where: viewablePurchaseOrderWhere(ctx, id),
    include: {
      lineItems: { include: { polineItemSerials: { select: { id: true } } } },
    },
  })

  if (!po) return notFound()

  const hasReceivedSerials = po.lineItems.some((li) => li.polineItemSerials.length > 0)
  if (hasReceivedSerials || po.status === "RECEIVED") {
    return NextResponse.json(
      { error: "This purchase order has already been received and has inventory tracked against it. It can't be deleted." },
      { status: 409 }
    )
  }

  await prisma.purchaseOrder.delete({ where: purchaseOrderWhere(ctx, po.id) })

  return NextResponse.json({ deleted: true })
}
