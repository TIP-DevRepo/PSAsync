import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const canViewAll = await hasPermission(session.user.id, "purchaseOrders.viewAll")

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      companyId: session.user.companyId,
      ...(canViewAll ? {} : { userId: session.user.id }),
    },
    include: {
      vendor: { select: { name: true } },
      user: { select: { name: true } },
      salesOrder: { select: { soNumber: true } },
      lineItems: { select: { unitCost: true, quantity: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  const result = purchaseOrders.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    vendorName: po.vendor.name,
    ownerName: po.user.name,
    soNumber: po.salesOrder?.soNumber ?? null,
    total: po.lineItems.reduce((sum, li) => sum + li.unitCost * li.quantity, 0),
    createdAt: po.createdAt,
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "purchaseOrders.create"))) {
    return NextResponse.json({ error: "You don't have permission to create Purchase Orders" }, { status: 403 })
  }

  const body = await req.json()
  const companyId = session.user.companyId

  if (!body.vendorId) {
    return NextResponse.json({ error: "A vendor is required" }, { status: 400 })
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId, companyId } })
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  const settings = await prisma.companySettings.findUnique({ where: { companyId } })
  const prefix = settings?.poPrefix ?? "PO"
  const paymentType = body.paymentType || settings?.poDefaultPaymentType || "Net30"

  const year = new Date().getFullYear()
  const existingCount = await prisma.purchaseOrder.count({ where: { companyId } })
  const poNumber = `${prefix}-${year}-${String(existingCount + 1).padStart(4, "0")}`

  // Two ways into this route: generating a PO from selected SO line items
  // (the existing "Generate Purchase Order" flow on a Sales Order), or
  // creating a blank PO manually with no line items yet — line items get
  // added afterward from the PO detail page in that case.
  const isGeneratingFromSO = Array.isArray(body.soLineItemIds) && body.soLineItemIds.length > 0

  let salesOrderId: string | null = body.salesOrderId || null
  let shipToClientId: string | null = null
  let lineItemsCreate: {
    sourceSOLineItemId: string
    name: string
    description: string | null
    sku: string | null
    quantity: number
    unitCost: number
    sortOrder: number
  }[] = []

  if (isGeneratingFromSO) {
    // Confirm every requested line item actually belongs to this company's SO
    const soLineItems = await prisma.sOLineItem.findMany({
      where: {
        id: { in: body.soLineItemIds },
        salesOrder: { companyId },
      },
    })
    if (soLineItems.length === 0) {
      return NextResponse.json({ error: "No valid line items found" }, { status: 400 })
    }
    salesOrderId = soLineItems[0].salesOrderId
    lineItemsCreate = soLineItems.map((li, idx) => ({
      sourceSOLineItemId: li.id,
      name: li.name,
      description: li.description,
      sku: li.sku,
      quantity: li.quantity,
      unitCost: li.cost,
      sortOrder: idx,
    }))
  }

  let shipToClientLocationId: string | null = null

  if (body.shipToClient) {
    if (salesOrderId) {
      // Linked to a Sales Order — the client comes from there, ignore
      // any standalone client picker value that might also be present.
      // Sales Orders don't capture a real ClientLocation link either
      // (same text-snapshot issue), so shipToClientLocationId stays
      // null here, receiving will fall back to asking once.
      const so = await prisma.salesOrder.findUnique({ where: { id: salesOrderId, companyId } })
      shipToClientId = so?.clientId ?? null
    } else if (body.shipClientId) {
      const client = await prisma.client.findUnique({ where: { id: body.shipClientId, companyId } })
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 })
      }
      shipToClientId = client.id

      if (body.shipClientLocationId) {
        const location = await prisma.clientLocation.findFirst({
          where: { id: body.shipClientLocationId, clientId: client.id },
        })
        if (!location) {
          return NextResponse.json({ error: "Shipping location not found for this client" }, { status: 404 })
        }
        shipToClientLocationId = location.id
      }
    }
  }

  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      companyId,
      salesOrderId,
      vendorId: body.vendorId,
      userId: session.user.id,
      poNumber,
      status: "DRAFT",
      paymentType,
      internalNotes: body.internalNotes || null,
      shipToClient: body.shipToClient ?? false,
      shipToClientId,
      shipToClientLocationId,
      shipContactName: body.shipContactName || null,
      shipAddress: body.shipAddress || null,
      shipAddress2: body.shipAddress2 || null,
      shipCity: body.shipCity || null,
      shipState: body.shipState || null,
      shipZip: body.shipZip || null,
      shipCountry: body.shipCountry || null,
      ...(lineItemsCreate.length > 0 ? { lineItems: { create: lineItemsCreate } } : {}),
    },
  })

  return NextResponse.json(purchaseOrder)
}