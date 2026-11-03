import { NextRequest, NextResponse } from "next/server"
import { notifyQuoteEvent } from "@/lib/notify"
import { alreadyRespondedResponse, AWAITING_RESPONSE_STATUSES, linkInvalidResponse, resolvePortalAccess } from "@/lib/portal-access"
import { optionalText, PORTAL_DECLINE_REASON_MAX, readPortalBody } from "@/lib/portal-input"
import { portalQuoteSelect, toPortalQuote } from "@/lib/portal-public"
import { prisma } from "@/lib/prisma"
import { applyQuoteEvent } from "@/lib/opportunity-quotes"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  // Only while the quote is waiting on the customer (SENT or VIEWED) and
  // not expired; anything else is refused here
  const access = await resolvePortalAccess(token, "act", { request: req })
  if (!access.ok) return access.response

  const body = await readPortalBody(req)
  const reason = optionalText(body.reason, "Decline reason", PORTAL_DECLINE_REASON_MAX)
  if (!reason.ok) return NextResponse.json({ error: reason.error }, { status: 400 })

  const quote = await prisma.quote.findUnique({ where: { id: access.quoteId } })
  if (!quote) return linkInvalidResponse()

  // One conditional write on the quote still waiting on the customer, so of
  // a decline and an accept sent at the same time exactly one wins. Only
  // the winner notifies. The winner's declined event (which may move the
  // opportunity to Lost) is applied in the same transaction, as the system.
  const decided = await prisma.$transaction(async (tx) => {
    const lost = await tx.quote.updateMany({
      where: { id: quote.id, status: { in: [...AWAITING_RESPONSE_STATUSES] } },
      data: {
        status: "DECLINED",
        declinedAt: new Date(),
        declineReason: reason.value ?? null,
      },
    })
    if (lost.count === 1) await applyQuoteEvent(tx, { companyId: quote.companyId, quoteId: quote.id, event: "declined", actorId: null })
    return lost
  })
  if (decided.count !== 1) return alreadyRespondedResponse()

  const updated = await prisma.quote.findUnique({ where: { id: quote.id }, select: portalQuoteSelect })
  if (!updated) return linkInvalidResponse()

  notifyQuoteEvent(quote.id, "QUOTE_LOST").catch((err) =>
    console.error("notifyQuoteEvent failed:", err)
  )

  return NextResponse.json(toPortalQuote(updated, false))
}