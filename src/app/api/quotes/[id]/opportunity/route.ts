import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { viewableQuoteWhere } from "@/lib/scoped-loaders"
import { isTermsFrozen } from "@/lib/quote-terms"
import { createLinkedOpportunity, loadRecordOpportunityPanel, planAutoOpportunity } from "@/lib/opportunity-quotes"
import { userFacingError } from "@/lib/user-error"

// The quote page's Opportunity panel: the opportunity its family is linked
// to (only for users who may open it) and that opportunity's other linked
// records the user may open, with the Related tab's cost rule
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({ permission: "pages.quotes", message: "You do not have permission to view quotes" })
  if (response) return response

  const { id } = await params
  const quote = await prisma.quote.findFirst({ where: viewableQuoteWhere(ctx, id), select: { opportunityId: true } })
  if (!quote) return notFound()

  return NextResponse.json(await loadRecordOpportunityPanel(ctx, quote.opportunityId))
}

const QUOTE_HAS_OPPORTUNITY_MESSAGE = "This quote already has an opportunity"
const QUOTE_NOT_SENT_MESSAGE = "Only a sent or closed quote can have its opportunity created here. A draft gets one when it is sent."

// The "Create opportunity" button on a sent or closed quote that has none
// (one sent before quotes were linked): creates it the way sending does
// (planAutoOpportunity) and links the quote's family, without changing the
// quote's status. Needs quotes.edit and the quote view check.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({ permission: "quotes.edit", message: "You do not have permission to edit quotes" })
  if (response) return response

  const { id } = await params
  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    select: { id: true, status: true, sentAt: true, opportunityId: true },
  })
  if (!quote) return notFound()
  if (quote.opportunityId) return apiError(409, QUOTE_HAS_OPPORTUNITY_MESSAGE, "HAS_OPPORTUNITY")
  if (!isTermsFrozen(quote)) return apiError(400, QUOTE_NOT_SENT_MESSAGE)

  const planned = await planAutoOpportunity(ctx.companyId, quote.id, "button")
  if (planned.error !== undefined) return apiError(400, planned.error)
  if (!planned.plan) return apiError(409, QUOTE_HAS_OPPORTUNITY_MESSAGE, "HAS_OPPORTUNITY")
  const plan = planned.plan

  try {
    const created = await prisma.$transaction((tx) => createLinkedOpportunity(tx, { companyId: ctx.companyId, quoteId: quote.id, plan, actorId: ctx.userId }))
    // Another request linked it first
    if (!created) return apiError(409, QUOTE_HAS_OPPORTUNITY_MESSAGE, "HAS_OPPORTUNITY")
    return NextResponse.json({ opportunityId: created.id, number: created.number })
  } catch (err) {
    const { message, status } = userFacingError(err, "Creating a quote's opportunity")
    return apiError(status, message)
  }
}
