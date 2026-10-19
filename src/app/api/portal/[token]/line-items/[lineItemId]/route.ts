import { NextRequest, NextResponse } from "next/server"
import { linkInvalidResponse, resolvePortalAccess } from "@/lib/portal-access"
import { prisma } from "@/lib/prisma"
import { portalLineItemSelect } from "@/lib/portal-public"
import { checkOptionalSelected, checkQuantity, readPortalBody } from "@/lib/portal-input"
import { withDeadlockRetry } from "@/lib/withDeadlockRetry"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; lineItemId: string }> }
) {
  const { token, lineItemId } = await params
  // Only while the quote is waiting on the customer and not expired
  const access = await resolvePortalAccess(token, "act")
  if (!access.ok) return access.response

  const body = await readPortalBody(req)

  const quote = await prisma.quote.findUnique({ where: { id: access.quoteId } })
  if (!quote) return linkInvalidResponse()

  const lineItem = await prisma.quoteLineItem.findUnique({ where: { id: lineItemId } })
  if (!lineItem || lineItem.quoteId !== quote.id) {
    return NextResponse.json({ error: "Line item not found" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}

  // Toggling whether an optional item is included
  if (body.optionalSelected !== undefined) {
    const selected = checkOptionalSelected(body.optionalSelected)
    if (!selected.ok) return NextResponse.json({ error: selected.error }, { status: 400 })
    if (!lineItem.isOptional) {
      return NextResponse.json({ error: "This item is not optional" }, { status: 400 })
    }
    // Choice-group items act like radio buttons — you can't deselect one
    // without picking another, and selecting one clears its group-mates
    if (lineItem.choiceGroup && !selected.value) {
      return NextResponse.json(
        { error: "Pick a different option instead — you can't leave this choice unselected." },
        { status: 400 }
      )
    }
    data.optionalSelected = selected.value
  }

  // Changing quantity, only allowed on items explicitly marked adjustable
  if (body.quantity !== undefined) {
    const qty = checkQuantity(body.quantity)
    if (!qty.ok) return NextResponse.json({ error: qty.error }, { status: 400 })
    if (!lineItem.quantityAdjustable) {
      return NextResponse.json({ error: "This item's quantity can't be changed" }, { status: 400 })
    }
    data.quantity = qty.value
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