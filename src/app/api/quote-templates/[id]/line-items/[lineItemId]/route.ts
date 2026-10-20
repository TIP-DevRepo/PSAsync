import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { RecurringInterval } from "@/generated/prisma"
import { apiError, canSeeCost, isEnumValue, notFound, omitCost, requireAccess } from "@/lib/api-access"
import { mayWriteCost } from "@/lib/line-item-cost"

// Templates are maintained from Quote Settings
const TEMPLATE_WRITE_RULE = {
  settingsSection: "quotes",
  message: "You do not have permission to edit quote templates",
} as const

// The line item, only when it sits on the template in the URL and that
// template belongs to this company
function getOwnedLineItem(templateId: string, lineItemId: string, companyId: string) {
  return prisma.quoteTemplateLineItem.findFirst({
    where: { id: lineItemId, templateId, template: { id: templateId, companyId } },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const { ctx, response } = await requireAccess(TEMPLATE_WRITE_RULE)
  if (response) return response

  const { id: templateId, lineItemId } = await params
  const existing = await getOwnedLineItem(templateId, lineItemId, ctx.companyId)
  if (!existing) return notFound()

  const body = await req.json()

  // Same rules as the writes below, and as the quote line item PATCH:
  // turning recurring on falls back to MONTHLY, and an interval sent on its
  // own is written as is, so either must be a real interval
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
  if (mayWriteCost(ctx, body.cost)) data.cost = Number(body.cost)
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
      const sibling = await prisma.quoteTemplateLineItem.findFirst({
        where: { templateId: existing.templateId, choiceGroup: group, id: { not: lineItemId } },
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

  const lineItem = await prisma.quoteTemplateLineItem.update({
    where: { id: lineItemId, templateId: existing.templateId },
    data,
  })

  // A bundle's display mode (collapsed vs itemized) applies to every item
  // in it, not just the one that got edited
  const bundleForCascade = data.bundleName ?? lineItem.bundleName
  if (body.bundleDisplayMode !== undefined && bundleForCascade) {
    await prisma.quoteTemplateLineItem.updateMany({
      where: { templateId: existing.templateId, bundleName: bundleForCascade, id: { not: lineItemId } },
      data: { bundleDisplayMode: body.bundleDisplayMode },
    })
  }

  // Renaming a bundle header: point every child at the new bundleName
  if (existing.isBundleHeader && body.name !== undefined && body.name !== existing.name && existing.bundleName) {
    await prisma.quoteTemplateLineItem.updateMany({
      where: { templateId: existing.templateId, bundleName: existing.bundleName, isBundleHeader: false },
      data: { bundleName: body.name },
    })
  }

  return NextResponse.json(canSeeCost(ctx) ? lineItem : omitCost(lineItem))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const { ctx, response } = await requireAccess(TEMPLATE_WRITE_RULE)
  if (response) return response

  const { id: templateId, lineItemId } = await params
  const existing = await getOwnedLineItem(templateId, lineItemId, ctx.companyId)
  if (!existing) return notFound()

  await prisma.quoteTemplateLineItem.delete({ where: { id: lineItemId, templateId: existing.templateId } })

  return NextResponse.json({ deleted: true })
}