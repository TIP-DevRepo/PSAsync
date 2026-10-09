import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { withDeadlockRetry } from "@/lib/withDeadlockRetry"
import { RecurringInterval } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"

// Confirms the line item exists and belongs to a quote owned by this company
async function getOwnedLineItem(lineItemId: string, companyId: string) {
  const lineItem = await prisma.quoteLineItem.findUnique({
    where: { id: lineItemId },
    include: { quote: { select: { companyId: true, status: true } } },
  })
  if (!lineItem || lineItem.quote.companyId !== companyId) return null
  return lineItem
}

const LOCK_MESSAGE =
  "This quote has been sent and is locked. Create a new version to make changes."

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { lineItemId } = await params
  const existing = await getOwnedLineItem(lineItemId, ctx.companyId)
  if (!existing) {
    return NextResponse.json({ error: "Line item not found" }, { status: 404 })
  }
  if (!["DRAFT", "PENDING_APPROVAL"].includes(existing.quote.status)) {
    return NextResponse.json({ error: LOCK_MESSAGE }, { status: 400 })
  }

  const body = await req.json()

  // Same rules as the writes below: turning recurring on falls back to
  // MONTHLY, and an interval sent on its own is written as is
  const interval = body.recurringInterval
  const writesInterval =
    body.isRecurring !== undefined ? Boolean(body.isRecurring) && !!interval : interval !== undefined && interval !== null
  if (writesInterval && !isEnumValue(RecurringInterval, interval)) {
    return apiError(400, "Invalid recurring interval")
  }

  // Only update fields that were actually sent, so partial saves (e.g. one
  // field losing focus) don't clobber the rest of the row
  const data: Record<string, unknown> = {}
  if (body.section !== undefined) data.section = body.section || null
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder)
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description || null
  if (body.sku !== undefined) data.sku = body.sku || null
  if (body.quantity !== undefined) data.quantity = Number(body.quantity)
  if (body.unitPrice !== undefined) data.unitPrice = Number(body.unitPrice)
  if (body.cost !== undefined) data.cost = Number(body.cost)
  if (body.discount !== undefined) data.discount = Number(body.discount)
  if (body.taxable !== undefined) data.taxable = Boolean(body.taxable)
  if (body.isOptional !== undefined) data.isOptional = Boolean(body.isOptional)
  if (body.quantityAdjustable !== undefined) data.quantityAdjustable = Boolean(body.quantityAdjustable)
  if (body.choiceGroup !== undefined) {
    const group = body.choiceGroup ? String(body.choiceGroup).trim() : null
    data.choiceGroup = group
    if (group) {
      // Choice-group items are always optional (only the chosen one counts
      // toward totals) — force it on so admins don't have to remember
      data.isOptional = true
      // Default: first item added to a group is selected, later ones aren't,
      // so the group always starts with exactly one option chosen
      const sibling = await prisma.quoteLineItem.findFirst({
        where: { quoteId: existing.quoteId, choiceGroup: group, id: { not: lineItemId } },
      })
      data.optionalSelected = !sibling
    }
  }
  if (body.isTextBlock !== undefined) data.isTextBlock = Boolean(body.isTextBlock)
  if (body.isBundleHeader !== undefined) data.isBundleHeader = Boolean(body.isBundleHeader)
  if (body.bundleName !== undefined) {
    data.bundleName = body.bundleName ? String(body.bundleName).trim() || null : null
  }
  if (body.bundleDisplayMode !== undefined) {
    data.bundleDisplayMode = body.bundleDisplayMode
  }
  // Renaming a bundle header also updates its join key (bundleName), so
  // every item inside it stays linked to the new name
  if (existing.isBundleHeader && body.name !== undefined && body.name !== existing.name) {
    data.bundleName = body.name
  }
  if (body.isRecurring !== undefined) {
    data.isRecurring = Boolean(body.isRecurring)
    data.recurringInterval = body.isRecurring ? body.recurringInterval || "MONTHLY" : null
  } else if (body.recurringInterval !== undefined) {
    data.recurringInterval = body.recurringInterval
  }

  const lineItem = await withDeadlockRetry(async () => {
    const result = await prisma.quoteLineItem.update({
      where: { id: lineItemId },
      data,
    })

    // A bundle's display mode (collapsed vs itemized) applies to every item
    // in it, not just the one that got edited
    const bundleForCascade = data.bundleName ?? result.bundleName
    if (body.bundleDisplayMode !== undefined && bundleForCascade) {
      await prisma.quoteLineItem.updateMany({
        where: { quoteId: existing.quoteId, bundleName: bundleForCascade, id: { not: lineItemId } },
        data: { bundleDisplayMode: body.bundleDisplayMode },
      })
    }

    // Renaming a bundle header: point every child at the new bundleName
    if (existing.isBundleHeader && body.name !== undefined && body.name !== existing.name && existing.bundleName) {
      await prisma.quoteLineItem.updateMany({
        where: { quoteId: existing.quoteId, bundleName: existing.bundleName, isBundleHeader: false },
        data: { bundleName: body.name },
      })
    }

    return result
  })

  return NextResponse.json(lineItem)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { lineItemId } = await params
  const existing = await getOwnedLineItem(lineItemId, session.user.companyId)
  if (!existing) {
    return NextResponse.json({ error: "Line item not found" }, { status: 404 })
  }
  if (!["DRAFT", "PENDING_APPROVAL"].includes(existing.quote.status)) {
    return NextResponse.json({ error: LOCK_MESSAGE }, { status: 400 })
  }

  await prisma.quoteLineItem.delete({ where: { id: lineItemId } })

  return NextResponse.json({ deleted: true })
}