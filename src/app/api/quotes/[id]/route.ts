import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withoutCustomerToken, withoutPortalTokens } from "@/lib/portal-token"
import { canSeeCost, notFound, omitCost, requireAccess } from "@/lib/api-access"
import { loadViewableQuote, quoteWhere, viewableQuoteWhere } from "@/lib/scoped-loaders"
import { termsForStorage } from "@/lib/sanitize-terms"

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

  // Line item cost (and the margin the builder works out from it) is only
  // sent to users who may see cost
  if (!canSeeCost(ctx)) {
    return NextResponse.json(withoutCustomerToken({ ...quote, lineItems: quote.lineItems.map(omitCost) }))
  }

  return NextResponse.json(withoutCustomerToken(quote))
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
  if (body.terms !== undefined) data.terms = termsForStorage(body.terms)
  if (body.useDefaultTerms !== undefined) data.useDefaultTerms = !!body.useDefaultTerms
  if (body.paymentTerms !== undefined) data.paymentTerms = body.paymentTerms || null
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null

  const updated = await prisma.quote.update({ where: quoteWhere(ctx, id), data })

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

  await prisma.quote.delete({ where: quoteWhere(ctx, id) })

  return NextResponse.json({ deleted: true })
}
