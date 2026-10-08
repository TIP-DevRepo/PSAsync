import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { RecurringInterval } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id: quoteId } = await params

  // Confirm the quote belongs to this company before touching it
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId, companyId: ctx.companyId },
  })
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }
  if (!["DRAFT", "PENDING_APPROVAL"].includes(quote.status)) {
    return NextResponse.json(
      { error: "This quote has been sent and is locked. Create a new version to make changes." },
      { status: 400 }
    )
  }

  const body = await req.json()

  if (body.isRecurring && body.recurringInterval && !isEnumValue(RecurringInterval, body.recurringInterval)) {
    return apiError(400, "Invalid recurring interval")
  }
  const invalid = await assertRefs(ctx, { catalogItemId: body.catalogItemId })
  if (invalid) return invalid

  // Next sortOrder = current highest + 1, so new items land at the bottom
  const highest = await prisma.quoteLineItem.findFirst({
    where: { quoteId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })
  const sortOrder = (highest?.sortOrder ?? -1) + 1
  const isTextBlock = Boolean(body.isTextBlock)
  const isBundleHeader = Boolean(body.isBundleHeader)
  const isContentOnly = isTextBlock || isBundleHeader

  const lineItem = await prisma.quoteLineItem.create({
    data: {
      quoteId,
      catalogItemId: body.catalogItemId || null,
      section: body.section || null,
      sortOrder,
      name: body.name,
      description: body.description || null,
      sku: body.sku || null,
      quantity: isContentOnly ? 0 : Number(body.quantity) || 1,
      unitPrice: isContentOnly ? 0 : Number(body.unitPrice) || 0,
      cost: isContentOnly ? 0 : Number(body.cost) || 0,
      discount: isContentOnly ? 0 : Number(body.discount) || 0,
      taxable: isContentOnly ? false : body.taxable ?? true,
      isRecurring: isContentOnly ? false : body.isRecurring ?? false,
      recurringInterval: !isContentOnly && body.isRecurring ? body.recurringInterval || "MONTHLY" : null,
      isOptional: isContentOnly ? false : body.isOptional ?? false,
      quantityAdjustable: isContentOnly ? false : body.quantityAdjustable ?? false,
      choiceGroup: isContentOnly ? null : body.choiceGroup || null,
      bundleName: isTextBlock ? null : body.bundleName || null,
      bundleDisplayMode: body.bundleDisplayMode || "COLLAPSED",
      isTextBlock,
      isBundleHeader,
    },
  })

  return NextResponse.json(lineItem)
}