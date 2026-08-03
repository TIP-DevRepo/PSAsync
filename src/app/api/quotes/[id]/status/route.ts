import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { createSalesOrderFromAcceptedQuote } from "@/lib/sales-orders"

const VALID_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "quotes.changeStatus"))) {
    return NextResponse.json({ error: "You don't have permission to change a quote's status manually" }, { status: 403 })
  }

  const { id } = await params
  const companyId = session.user.companyId
  const body = await req.json()

  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const quote = await prisma.quote.findUnique({ where: { id, companyId } })
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  const data: Record<string, unknown> = { status: body.status }
  if (body.status === "SENT" && !quote.sentAt) data.sentAt = new Date()
  if (body.status === "ACCEPTED" && !quote.acceptedAt) data.acceptedAt = new Date()
  if (body.status === "DECLINED" && !quote.declinedAt) data.declinedAt = new Date()

  // Manually marking a quote SENT should make it the live version, same as
  // the normal send flow
  if (body.status === "SENT") {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.quote.updateMany({
        where: { companyId, quoteNumber: quote.quoteNumber, id: { not: id } },
        data: { isActive: false },
      })
      return tx.quote.update({ where: { id }, data: { ...data, isActive: true } })
    })
    return NextResponse.json(updated)
  }

  const updated = await prisma.quote.update({ where: { id }, data })

  if (body.status === "ACCEPTED") {
    try {
      await createSalesOrderFromAcceptedQuote(id)
    } catch (err) {
      console.error("createSalesOrderFromAcceptedQuote failed:", err)
    }
  }

  return NextResponse.json(updated)
}