import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withoutCustomerToken, withoutPortalTokens } from "@/lib/portal-token"
import { apiError, canSeeCost, notFound, omitCost, requireAccess } from "@/lib/api-access"
import { assertRefs, loadViewableQuote, quoteWhere, viewableQuoteWhere } from "@/lib/scoped-loaders"
import { readOptionalId } from "@/lib/opportunity-rules"
import { linkStillMatches, quoteLabel } from "@/lib/opportunity-quote-rules"
import { recordRecordLink, setQuoteFamilyOpportunity } from "@/lib/opportunity-quotes"
import { isTermsFrozen, loadCompanyDefaultTerms, quoteTermsView, requestTouchesTerms, termsPatchData } from "@/lib/quote-terms"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    include: {
      client: { select: { id: true, name: true, email: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      user: { select: { id: true, name: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  })

  if (!quote) return notFound()

  // The terms to show come from the shared resolver; `terms` stays the
  // stored text for the editor
  const termsView = quoteTermsView(quote, await loadCompanyDefaultTerms(ctx.companyId))

  // Line item cost (and the margin the builder works out from it) is only
  // sent to users who may see cost
  if (!canSeeCost(ctx)) {
    return NextResponse.json(withoutCustomerToken({ ...quote, ...termsView, lineItems: quote.lineItems.map(omitCost) }))
  }

  return NextResponse.json(withoutCustomerToken({ ...quote, ...termsView }))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.edit",
    message: "You do not have permission to edit quotes",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId

  const existing = await prisma.quote.findFirst({ where: viewableQuoteWhere(ctx, id) })
  if (!existing) return notFound()
  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft quotes can be edited this way." }, { status: 400 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}

  if (body.clientId !== undefined) {
    const client = await prisma.client.findUnique({ where: { id: body.clientId, companyId } })
    if (!client) {
      return NextResponse.json({ error: "Invalid client" }, { status: 400 })
    }
    data.clientId = body.clientId
  }

  if (body.contactId !== undefined) {
    if (body.contactId === null) {
      data.contactId = null
    } else {
      const contact = await prisma.contact.findUnique({ where: { id: body.contactId } })
      const effectiveClientId = (data.clientId as string | undefined) ?? existing.clientId
      if (!contact || contact.clientId !== effectiveClientId) {
        return NextResponse.json({ error: "Invalid contact for this client" }, { status: 400 })
      }
      data.contactId = body.contactId
    }
  }

  if (body.title !== undefined) data.title = body.title || null
  if (body.introText !== undefined) data.introText = body.introText || null
  // A frozen quote (sent, or moved past DRAFT and PENDING_APPROVAL) keeps
  // its terms
  if (requestTouchesTerms(body)) {
    if (isTermsFrozen(existing)) {
      return NextResponse.json(
        { error: "Terms can't be changed after a quote has been sent. Create a new version to change them." },
        { status: 400 }
      )
    }
    Object.assign(data, termsPatchData(existing.useDefaultTerms, body, await loadCompanyDefaultTerms(companyId)))
  }
  if (body.paymentTerms !== undefined) data.paymentTerms = body.paymentTerms || null
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null

  // The opportunity the quote family belongs to (null or blank unlinks):
  // an OPEN one of the quote's client and contact that the user may open.
  // A client or contact change that no longer matches the linked
  // opportunity clears the link.
  const clientId = (data.clientId as string | undefined) ?? existing.clientId
  const contactId = "contactId" in data ? (data.contactId as string | null) : existing.contactId
  let opportunityId = existing.opportunityId
  if (body.opportunityId !== undefined) {
    const chosen = readOptionalId(body.opportunityId)
    if (chosen.error !== undefined) return apiError(400, "Invalid opportunity", "INVALID_REFERENCE")
    if (chosen.value && chosen.value !== existing.opportunityId) {
      const invalid = await assertRefs(ctx, { clientId, contactId, quoteOpportunityId: chosen.value })
      if (invalid) return invalid
    }
    opportunityId = chosen.value
  }
  if (opportunityId && opportunityId === existing.opportunityId && (clientId !== existing.clientId || contactId !== existing.contactId)) {
    const linked = await prisma.opportunity.findFirst({ where: { id: opportunityId, companyId }, select: { clientId: true, contactId: true } })
    if (!linked || !linkStillMatches(linked, { clientId, contactId })) opportunityId = null
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.quote.update({ where: quoteWhere(ctx, id), data })
    await setQuoteFamilyOpportunity(tx, { companyId, actorId: ctx.userId, quoteNumber: existing.quoteNumber, from: existing.opportunityId, to: opportunityId })
    return { ...saved, opportunityId }
  })

  return NextResponse.json(withoutPortalTokens(updated))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.delete",
    message: "You do not have permission to delete quotes",
  })
  if (response) return response

  const { id } = await params

  const quote = await loadViewableQuote(ctx, id)
  if (!quote) return notFound()

  const salesOrder = await prisma.salesOrder.findUnique({ where: { quoteId: id }, select: { id: true } })
  if (salesOrder) {
    return NextResponse.json(
      { error: "This quote has a Sales Order linked to it and can't be deleted." },
      { status: 400 }
    )
  }

  // A linked quote's opportunity records that it is no longer linked, in
  // the same transaction as the delete
  const linked = await prisma.quote.findFirst({ where: quoteWhere(ctx, id), select: { opportunityId: true, quoteNumber: true, version: true } })
  await prisma.$transaction(async (tx) => {
    await tx.quote.delete({ where: quoteWhere(ctx, id) })
    if (linked?.opportunityId) {
      await recordRecordLink(tx, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        opportunityId: linked.opportunityId,
        kind: "quote",
        change: "unlinked",
        record: { id, name: quoteLabel(linked) },
        deleted: true,
      })
    }
  })

  return NextResponse.json({ deleted: true })
}
