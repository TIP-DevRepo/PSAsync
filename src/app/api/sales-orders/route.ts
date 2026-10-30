import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { userFacingError } from "@/lib/user-error"
import { isNumberCollision, NUMBER_TAKEN_MESSAGE, takeRecordNumber } from "@/lib/record-number"
import { assertRefs, salesOrderListWhere } from "@/lib/scoped-loaders"

export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: "pages.salesOrders",
    message: "You do not have permission to view sales orders",
  })
  if (response) return response

  // Own orders only, unless the user holds salesOrders.viewAll
  const salesOrders = await prisma.salesOrder.findMany({
    where: salesOrderListWhere(ctx),
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
  const { ctx, response } = await requireAccess({
    permission: "salesOrders.create",
    message: "You do not have permission to create sales orders",
  })
  if (response) return response

  const body = await req.json()

  if (!body.clientId) {
    return NextResponse.json({ error: "A client is required" }, { status: 400 })
  }
  const invalid = await assertRefs(ctx, { clientId: body.clientId })
  if (invalid) return invalid

  const companyId = ctx.companyId

  const settings = await prisma.companySettings.findUnique({ where: { companyId } })
  const prefix = settings?.soPrefix ?? "SO"

  // The next number from the company's sales order counter, taken in the
  // same transaction as the create so a failed create gives it back
  let salesOrder
  try {
    salesOrder = await prisma.$transaction(async (tx) => {
      const soNumber = await takeRecordNumber(tx, companyId, "salesOrder", prefix)
      return tx.salesOrder.create({
        data: {
          companyId,
          clientId: body.clientId,
          userId: ctx.userId,
          soNumber,
          clientPoNumber: body.clientPoNumber || null,
          paymentTerms: body.paymentTerms || null,
          internalNotes: body.internalNotes || null,
          clientNotes: body.clientNotes || null,
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
    })
  } catch (err) {
    if (isNumberCollision(err)) return apiError(409, NUMBER_TAKEN_MESSAGE, "NUMBER_TAKEN")
    const { message, status } = userFacingError(err, "Creating a sales order")
    return apiError(status, message)
  }

  return NextResponse.json(salesOrder)
}