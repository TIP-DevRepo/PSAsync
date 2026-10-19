import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, canSeeCost, notFound, omitCost, omitUnitCost, requireAccess } from "@/lib/api-access"
import { loadViewableSalesOrder, salesOrderWhere, viewableSalesOrderWhere } from "@/lib/scoped-loaders"
import { deleteStoredObjects } from "@/lib/uploads"
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
const VALID_PAYMENT_TERMS = ["", "Due on Receipt", "Net15", "Net30", "Net45", "Net60", "Prepaid"]

// Payment terms, client PO number, and billing/shipping details stop being
// editable once a Purchase Order has been generated from this order, same
// line the existing Delete block already draws, so there's one consistent
// definition of "too far along to change" rather than two different rules
// for Delete and Edit.
const EDIT_GATED_FIELDS = [
  "clientPoNumber",
  "paymentTerms",
  "billContactName",
  "billAddress",
  "billAddress2",
  "billCity",
  "billState",
  "billZip",
  "billCountry",
  "shipContactName",
  "shipAddress",
  "shipAddress2",
  "shipCity",
  "shipState",
  "shipZip",
  "shipCountry",
]

// Every field other than status needs salesOrders.edit, the notes included
const EDIT_FIELDS = [...EDIT_GATED_FIELDS, "internalNotes", "clientNotes"]

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.salesOrders",
    message: "You do not have permission to view sales orders",
  })
  if (response) return response

  const { id } = await params

  const salesOrder = await prisma.salesOrder.findFirst({
    where: viewableSalesOrderWhere(ctx, id),
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

  if (!salesOrder) return notFound()

  // Line item cost, and the cost on the linked purchase orders' lines, only
  // goes to users who can see cost
  if (!canSeeCost(ctx)) {
    return NextResponse.json({
      ...salesOrder,
      lineItems: salesOrder.lineItems.map(omitCost),
      purchaseOrders: salesOrder.purchaseOrders.map((po) => ({ ...po, lineItems: po.lineItems.map(omitUnitCost) })),
    })
  }

  return NextResponse.json(salesOrder)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Status needs salesOrders.changeStatus and every other field needs
  // salesOrders.edit, checked per field below once the body is read
  const { ctx, response } = await requireAccess({
    permission: ["salesOrders.edit", "salesOrders.changeStatus"],
    message: "You do not have permission to edit sales orders",
  })
  if (response) return response

  const { id } = await params

  const existing = await loadViewableSalesOrder(ctx, id)
  if (!existing) return notFound()

  const body = await req.json()

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!ctx.can("salesOrders.changeStatus")) {
      return apiError(403, "You do not have permission to change a sales order's status", "FORBIDDEN")
    }
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    data.status = body.status
  }

  if (EDIT_FIELDS.some((field) => body[field] !== undefined) && !ctx.can("salesOrders.edit")) {
    return apiError(403, "You do not have permission to edit sales orders", "FORBIDDEN")
  }

  const touchesGatedField = EDIT_GATED_FIELDS.some((field) => body[field] !== undefined)
  if (touchesGatedField) {
    const linkedPOCount = await prisma.purchaseOrder.count({
      where: { salesOrderId: existing.id, companyId: ctx.companyId },
    })
    if (linkedPOCount > 0) {
      return NextResponse.json(
        { error: "This sales order has purchase orders generated from it. Payment and billing/shipping details can no longer be edited." },
        { status: 409 }
      )
    }
  }

  if (body.clientPoNumber !== undefined) data.clientPoNumber = body.clientPoNumber || null
  if (body.paymentTerms !== undefined) {
    if (!VALID_PAYMENT_TERMS.includes(body.paymentTerms)) {
      return NextResponse.json({ error: "Invalid payment terms" }, { status: 400 })
    }
    data.paymentTerms = body.paymentTerms || null
  }
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

  const updated = await prisma.salesOrder.update({ where: salesOrderWhere(ctx, existing.id), data })

  // Fire notifications for the 3 statuses that have a configured notify rule
  if (body.status && ["READY_TO_INVOICE", "READY_TO_ORDER", "READY_TO_CLOSEOUT"].includes(body.status)) {
    notifySalesOrderStatusChange(existing.id, body.status).catch((err) =>
      console.error("notifySalesOrderStatusChange failed:", err)
    )
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "salesOrders.delete",
    message: "You do not have permission to delete sales orders",
  })
  if (response) return response

  const { id } = await params

  const salesOrder = await prisma.salesOrder.findFirst({
    where: viewableSalesOrderWhere(ctx, id),
    include: { purchaseOrders: { select: { id: true } } },
  })

  if (!salesOrder) return notFound()

  if (salesOrder.purchaseOrders.length > 0) {
    return NextResponse.json(
      {
        error: `This sales order has ${salesOrder.purchaseOrders.length} purchase order(s) linked to it and can't be deleted. Delete those first.`,
      },
      { status: 409 }
    )
  }

  // The attachment rows cascade with the order, so their files are
  // collected first and removed (best effort) once the delete succeeds
  const attachments = await prisma.sOAttachment.findMany({ where: { salesOrderId: salesOrder.id }, select: { fileUrl: true } })

  await prisma.salesOrder.delete({ where: salesOrderWhere(ctx, salesOrder.id) })

  await deleteStoredObjects(attachments.map((a) => a.fileUrl), `sales-orders/${salesOrder.id}/`)

  return NextResponse.json({ deleted: true })
}
