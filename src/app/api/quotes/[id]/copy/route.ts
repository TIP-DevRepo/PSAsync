import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewableQuoteWhere } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.create",
    message: "You do not have permission to create quotes",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId

  const source = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    include: { lineItems: true },
  })
  if (!source) return notFound()

  const settings = await prisma.companySettings.findUnique({ where: { companyId } })
  const prefix = settings?.quotePrefix ?? "Q"
  const year = new Date().getFullYear()
  const existingCount = await prisma.quote.count({ where: { companyId, version: 1 } })
  const quoteNumber = `${prefix}-${year}-${String(existingCount + 1).padStart(4, "0")}`

  const copy = await prisma.quote.create({
    data: {
      companyId,
      clientId: source.clientId,
      contactId: source.contactId,
      // The copy belongs to whoever made it, so they can always open it
      userId: ctx.userId,
      quoteNumber,
      templateId: source.templateId,
      title: source.title ? `${source.title} (Copy)` : null,
      introText: source.introText,
      terms: source.terms,
      internalNotes: source.internalNotes,
      clientPoNumber: source.clientPoNumber,
      expiresAt: source.expiresAt,
      taxRate: source.taxRate,
      lineItems: {
        create: source.lineItems.map((li) => ({
          catalogItemId: li.catalogItemId,
          section: li.section,
          sortOrder: li.sortOrder,
          name: li.name,
          description: li.description,
          sku: li.sku,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          cost: li.cost,
          discount: li.discount,
          taxable: li.taxable,
          isRecurring: li.isRecurring,
          recurringInterval: li.recurringInterval,
          isOptional: li.isOptional,
          optionalSelected: li.optionalSelected,
        })),
      },
    },
  })

  return NextResponse.json(copy)
}