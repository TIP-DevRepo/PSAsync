import { NextRequest, NextResponse } from "next/server"
import { resolveClientQuoteId } from "@/lib/portal-quote"
import { prisma } from "@/lib/prisma"
import { portalLineItemSelect } from "@/lib/portal-public"
import { withDeadlockRetry } from "@/lib/withDeadlockRetry"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; lineItemId: string }> }
) {
  const { token, lineItemId } = await params
  const body = await req.json()

  const activeId = await resolveClientQuoteId(token)
  if (!activeId) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  const quote = await prisma.quote.findUnique({ where: { id: activeId } })
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }
  if (["ACCEPTED", "DECLINED", "EXPIRED"].includes(quote.status)) {
    return NextResponse.json({ error: "This quote can no longer be modified" }, { status: 400 })
  }

  const lineItem = await prisma.quoteLineItem.findUnique({ where: { id: lineItemId } })
  if (!lineItem || lineItem.quoteId !== quote.id) {
    return NextResponse.json({ error: "Line item not found" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}

  // Toggling whether an optional item is included
  if (body.optionalSelected !== undefined) {
    if (!lineItem.isOptional) {
      return NextResponse.json({ error: "This item is not optional" }, { status: 400 })
    }
    // Choice-group items act like radio buttons — you can't deselect one
    // without picking another, and selecting one clears its group-mates
    if (lineItem.choiceGroup && !body.optionalSelected) {
      return NextResponse.json(
        { error: "Pick a different option instead — you can't leave this choice unselected." },
        { status: 400 }
      )
    }
    data.optionalSelected = Boolean(body.optionalSelected)
  }

  // Changing quantity, only allowed on items explicitly marked adjustable
  if (body.quantity !== undefined) {
    if (!lineItem.quantityAdjustable) {
      return NextResponse.json({ error: "This item's quantity can't be changed" }, { status: 400 })
    }
    const qty = Number(body.quantity)
    if (!Number.isFinite(qty) || qty < 0) {
      return NextResponse.json({ error: "Invalid quantity" }, { status: 400 })
    }
    data.quantity = qty
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const updated = await withDeadlockRetry(async () => {
    if (lineItem.choiceGroup && data.optionalSelected === true) {
      // Selecting one option in a this-or-that group deselects the rest
      const [, result] = await prisma.$transaction([
        prisma.quoteLineItem.updateMany({
          where: { quoteId: quote.id, choiceGroup: lineItem.choiceGroup, id: { not: lineItemId } },
          data: { optionalSelected: false },
        }),
        prisma.quoteLineItem.update({ where: { id: lineItemId }, data, select: portalLineItemSelect }),
      ])
      return result
    }
    return prisma.quoteLineItem.update({
      where: { id: lineItemId },
      data,
      select: portalLineItemSelect,
    })
  })

  return NextResponse.json(updated)
}