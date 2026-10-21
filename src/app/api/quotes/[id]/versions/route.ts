import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { quoteListWhere, viewableQuoteWhere } from "@/lib/scoped-loaders"
import { newAccessToken, withoutPortalTokens } from "@/lib/portal-token"
import { termsForStorage } from "@/lib/sanitize-terms"
import { copiedLineData, COPY_SOURCE_LINE_ORDER } from "@/lib/quote-line-copy"

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
    include: { lineItems: { orderBy: COPY_SOURCE_LINE_ORDER } },
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
      // The new version is a draft: with the flag ticked it follows the current default
      useDefaultTerms: current.useDefaultTerms,
      internalNotes: current.internalNotes,
      clientPoNumber: current.clientPoNumber,
      expiresAt: current.expiresAt,
      taxRate: current.taxRate,
      // The section list keeps the order and any section with no lines yet
      sections: current.sections,
      lineItems: { create: current.lineItems.map(copiedLineData) },
    },
  })

  return NextResponse.json(withoutPortalTokens(newQuote))
}