import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewableQuoteWhere } from "@/lib/scoped-loaders"
import { newAccessToken, withoutPortalTokens } from "@/lib/portal-token"
import { termsForStorage } from "@/lib/sanitize-terms"
import { copiedLineData, COPY_SOURCE_LINE_ORDER } from "@/lib/quote-line-copy"

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
    include: { lineItems: { orderBy: COPY_SOURCE_LINE_ORDER } },
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
      accessToken: newAccessToken(),
      internalAccessToken: newAccessToken(),
      templateId: source.templateId,
      title: source.title ? `${source.title} (Copy)` : null,
      introText: source.introText,
      terms: termsForStorage(source.terms),
      // The copy is a draft: with the flag ticked it follows the current default
      useDefaultTerms: source.useDefaultTerms,
      internalNotes: source.internalNotes,
      clientPoNumber: source.clientPoNumber,
      expiresAt: source.expiresAt,
      taxRate: source.taxRate,
      // The section list keeps the order and any section with no lines yet
      sections: source.sections,
      // Every kind of line, cost from the stored rows
      lineItems: { create: source.lineItems.map(copiedLineData) },
    },
  })

  return NextResponse.json(withoutPortalTokens(copy))
}