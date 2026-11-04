import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withoutPortalTokens } from "@/lib/portal-token"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { viewableQuoteWhere } from "@/lib/scoped-loaders"
import { createSalesOrderFromAcceptedQuote } from "@/lib/sales-orders"
import { errorSummary } from "@/lib/user-error"
import { applyTermsFreeze, isFrozenStatus, loadCompanyDefaultTerms, termsFreezeFor, UNFROZEN_STATUSES } from "@/lib/quote-terms"
import { approvalsStillGranted, loadMatchingWorkflows } from "@/lib/approval-workflows"
import { prepareQuoteStatusChange, runQuoteStatusChange } from "@/lib/opportunity-quotes"
import type { QuoteStatus } from "@/generated/prisma"

// The statuses that put a quote in front of the customer (or record their
// acceptance), so reaching them from DRAFT or PENDING_APPROVAL needs every
// matching approval workflow approved
const APPROVAL_CHECKED_STATUSES = ["SENT", "VIEWED", "ACCEPTED"]
const NEEDS_APPROVAL_MESSAGE =
  "This quote needs approval before it can be changed to this status. Use Send Quote to request approval."

const VALID_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.changeStatus",
    message: "You don't have permission to change a quote's status manually",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId
  const body = await req.json()

  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    include: { lineItems: { select: { id: true, quantity: true, unitPrice: true, discount: true } } },
  })
  if (!quote) return notFound()

  // A quote that hasn't gone out yet only reaches the customer facing
  // statuses through the approval workflows, the same check send and
  // send-email run (src/lib/approval-workflows.ts). DECLINED, EXPIRED, and
  // moves from a status already past DRAFT and PENDING_APPROVAL are not
  // checked.
  if (UNFROZEN_STATUSES.includes(quote.status) && APPROVAL_CHECKED_STATUSES.includes(body.status)) {
    const matched = await loadMatchingWorkflows(companyId, quote)
    if (matched.length > 0 && !(await approvalsStillGranted(quote, matched))) {
      return apiError(400, NEEDS_APPROVAL_MESSAGE, "APPROVAL_REQUIRED")
    }
  }

  // A quote leaving Draft without an opportunity gets one (planned here, so
  // one that can't have one is refused before anything changes), and the
  // change's quote event (sent, accepted, declined, expired) moves the
  // opportunity's stage, both in the transaction that changes the status
  const to = body.status as QuoteStatus
  const prepared = await prepareQuoteStatusChange(companyId, quote, to)
  if (prepared.error !== undefined) return apiError(400, prepared.error)
  const automation = { companyId, quoteId: id, from: quote.status, to, actorId: ctx.userId, plan: prepared.plan }

  const data: Record<string, unknown> = { status: body.status }
  if (body.status === "SENT" && !quote.sentAt) data.sentAt = new Date()
  if (body.status === "ACCEPTED" && !quote.acceptedAt) data.acceptedAt = new Date()
  if (body.status === "DECLINED" && !quote.declinedAt) data.declinedAt = new Date()

  // Any status past DRAFT and PENDING_APPROVAL freezes the terms: a quote
  // not frozen yet that uses the company default keeps the default as it
  // is now, written in the same transaction as the status change. This
  // covers the bulk Mark Lost and Mark Expired actions, which call here.
  const freeze = isFrozenStatus(body.status) ? termsFreezeFor(quote, await loadCompanyDefaultTerms(companyId)) : null

  // Manually marking a quote SENT should make it the live version, same as
  // the normal send flow
  if (body.status === "SENT") {
    const updated = await prisma.$transaction(async (tx) => {
      await applyTermsFreeze(tx, id, freeze)
      await tx.quote.updateMany({
        where: { companyId, quoteNumber: quote.quoteNumber, id: { not: id } },
        data: { isActive: false },
      })
      const saved = await tx.quote.update({ where: { id }, data: { ...data, isActive: true } })
      await runQuoteStatusChange(tx, automation)
      return saved
    })
    return NextResponse.json(withoutPortalTokens(updated))
  }

  const updated = await prisma.$transaction(async (tx) => {
    await applyTermsFreeze(tx, id, freeze)
    const saved = await tx.quote.update({ where: { id }, data })
    await runQuoteStatusChange(tx, automation)
    return saved
  })

  if (body.status === "ACCEPTED") {
    try {
      await createSalesOrderFromAcceptedQuote(id, ctx.userId)
    } catch (err) {
      console.error(`createSalesOrderFromAcceptedQuote failed: ${errorSummary(err)}`)
    }
  }

  return NextResponse.json(withoutPortalTokens(updated))
}