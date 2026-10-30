import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, clientWhere, viewableQuoteWhere } from "@/lib/scoped-loaders"
import { newAccessToken, withoutPortalTokens } from "@/lib/portal-token"
import { termsForStorage } from "@/lib/sanitize-terms"
import { copiedLineData, COPY_SOURCE_LINE_ORDER } from "@/lib/quote-line-copy"
import { clientDefaultsSelect, clientQuoteDefaults } from "@/lib/quote-client-defaults"
import { DEFAULT_QUOTE_EXPIRY_DAYS, expiryDateFromToday } from "@/lib/quote-expiry"
import { userFacingError } from "@/lib/user-error"
import { isNumberCollision, NUMBER_TAKEN_MESSAGE, takeRecordNumber } from "@/lib/record-number"

// A copy takes only the quote's details and items: its title, intro, terms,
// sections, and line items. The rep picks the client and contact for the
// copy, which then gets that client's payment terms and ship to address the
// way a new quote does, a new number, new links, and a new expiry. Nothing
// about the original customer or its progress (status, sends, approvals,
// comments, signature, PO number, internal notes) comes along.
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

  // Older pages posted no body at all
  const body = (await req.json().catch(() => null)) ?? {}
  if (body.clientId === undefined || body.clientId === null || body.clientId === "") {
    return apiError(400, "A client is required")
  }
  if (body.contactId === undefined || body.contactId === null || body.contactId === "") {
    return apiError(400, "A contact is required")
  }

  // One id each (assertRefs would also take a list), the client of this
  // company and the contact of that client
  if (typeof body.clientId !== "string") return apiError(400, "Invalid client", "INVALID_REFERENCE")
  if (typeof body.contactId !== "string") return apiError(400, "Invalid contact", "INVALID_REFERENCE")
  const clientId: string = body.clientId
  const contactId: string = body.contactId
  const invalid = await assertRefs(ctx, { clientId, contactId })
  if (invalid) return invalid

  const client = await prisma.client.findFirst({ where: clientWhere(ctx, clientId), select: clientDefaultsSelect })
  if (!client) return apiError(400, "Invalid client", "INVALID_REFERENCE")
  const defaults = clientQuoteDefaults(client)

  const settings = await prisma.companySettings.findUnique({ where: { companyId } })
  const prefix = settings?.quotePrefix ?? "Q"

  // Expiry days the way the New Quote form picks them: the template's when
  // the quote was made from one that still exists, else the company default
  const template = source.templateId
    ? await prisma.quoteTemplate.findFirst({ where: { id: source.templateId, companyId }, select: { expiryDays: true } })
    : null
  const expiryDays = template?.expiryDays || settings?.quoteExpiryDays || DEFAULT_QUOTE_EXPIRY_DAYS

  // The next number from the company's quote counter, taken in the same
  // transaction as the create so a failed create gives it back
  let copy
  try {
    copy = await prisma.$transaction(async (tx) => {
      const quoteNumber = await takeRecordNumber(tx, companyId, "quote", prefix)
      return tx.quote.create({
        data: {
          companyId,
          clientId,
          contactId,
          // The copy belongs to whoever made it, so they can always open it
          userId: ctx.userId,
          quoteNumber,
          accessToken: newAccessToken(),
          internalAccessToken: newAccessToken(),
          templateId: source.templateId,
          title: source.title ? `${source.title} (Copy)` : null,
          introText: source.introText,
          // The copy is a draft: with the flag ticked it stores a copy of the
          // current default, like a new quote, otherwise the source's own text
          useDefaultTerms: source.useDefaultTerms,
          terms: source.useDefaultTerms ? termsForStorage(settings?.quoteTerms) : termsForStorage(source.terms),
          paymentTerms: defaults.paymentTerms || null,
          shipAddress: defaults.shipAddress || null,
          shipAddress2: defaults.shipAddress2 || null,
          shipCity: defaults.shipCity || null,
          shipState: defaults.shipState || null,
          shipZip: defaults.shipZip || null,
          shipCountry: defaults.shipCountry || null,
          expiresAt: expiryDateFromToday(expiryDays),
          // The section list keeps the order and any section with no lines yet
          sections: source.sections,
          // Every kind of line, cost from the stored rows
          lineItems: { create: source.lineItems.map(copiedLineData) },
        },
      })
    })
  } catch (err) {
    if (isNumberCollision(err)) return apiError(409, NUMBER_TAKEN_MESSAGE, "NUMBER_TAKEN")
    const { message, status } = userFacingError(err, "Copying a quote")
    return apiError(status, message)
  }

  return NextResponse.json(withoutPortalTokens(copy))
}
