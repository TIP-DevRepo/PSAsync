import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { quoteListWhere, viewableQuoteWhere } from "@/lib/scoped-loaders"
import { newAccessToken, withoutPortalTokens } from "@/lib/portal-token"
import { termsForStorage } from "@/lib/sanitize-terms"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const current = await prisma.quote.findFirst({ where: viewableQuoteWhere(ctx, id) })
  if (!current) return notFound()

  // All versions of a quote share the same quote number. Only the ones
  // this user may open are listed.
  const versions = await prisma.quote.findMany({
    where: { ...quoteListWhere(ctx), quoteNumber: current.quoteNumber },
    select: { id: true, version: true, status: true, createdAt: true, sentAt: true, isActive: true },
    orderBy: { version: "asc" },
  })

  return NextResponse.json(versions)
}

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

  const current = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    include: { lineItems: true },
  })
  if (!current) return notFound()

  const highest = await prisma.quote.findFirst({
    where: { companyId, quoteNumber: current.quoteNumber },
    orderBy: { version: "desc" },
    select: { version: true },
  })
  const nextVersion = (highest?.version ?? current.version) + 1

  const newQuote = await prisma.quote.create({
    data: {
      companyId,
      clientId: current.clientId,
      contactId: current.contactId,
      userId: current.userId,
      quoteNumber: current.quoteNumber,
      version: nextVersion,
      // Each version is its own row with its own tokens
      accessToken: newAccessToken(),
      internalAccessToken: newAccessToken(),
      parentId: current.id,
      isActive: false,
      status: "DRAFT",
      title: current.title,
      introText: current.introText,
      terms: termsForStorage(current.terms),
      internalNotes: current.internalNotes,
      clientPoNumber: current.clientPoNumber,
      expiresAt: current.expiresAt,
      taxRate: current.taxRate,
      lineItems: {
        create: current.lineItems.map((li) => ({
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
          quantityAdjustable: li.quantityAdjustable,
          choiceGroup: li.choiceGroup,
          isTextBlock: li.isTextBlock,
          bundleName: li.bundleName,
          bundleDisplayMode: li.bundleDisplayMode,
          isBundleHeader: li.isBundleHeader,
        })),
      },
    },
  })

  return NextResponse.json(withoutPortalTokens(newQuote))
}