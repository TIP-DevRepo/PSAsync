import { NextRequest, NextResponse } from "next/server"
import { notifyQuoteEvent } from "@/lib/notify"
import {
  AWAITING_RESPONSE_STATUSES,
  expiredBrandingResponse,
  linkInvalidResponse,
  resolvePortalAccess,
} from "@/lib/portal-access"
import { portalQuoteSelect, toPortalQuote } from "@/lib/portal-public"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const access = await resolvePortalAccess(token, "view", { allowInternal: true })
  if (!access.ok) {
    // An expired link shows only the company's branding. A quote still
    // waiting on the customer is recorded as expired the first time its
    // link is opened after the date, so staff lists show it.
    if (access.expiredQuote) {
      const expired = access.expiredQuote
      if (AWAITING_RESPONSE_STATUSES.includes(expired.status)) {
        await prisma.quote.updateMany({
          where: { id: expired.id, status: { in: [...AWAITING_RESPONSE_STATUSES] } },
          data: { status: "EXPIRED" },
        })
      }
      return expiredBrandingResponse(expired.companyId)
    }
    return access.response
  }
  const { quoteId: activeId, isInternal, superseded } = access

  const quote = await prisma.quote.findUnique({
    where: { id: activeId },
    select: portalQuoteSelect,
  })

  if (!quote) return linkInvalidResponse()

  // The internal preview never changes the quote: viewing it must never
  // mark it viewed or notify the owner the way a real client visit does
  if (isInternal) {
    return NextResponse.json({ ...toPortalQuote(quote, true), superseded: false })
  }

  if (quote.status === "SENT") {
    // First time the client opens it — mark as viewed and notify the rep.
    // Only fires on this SENT -> VIEWED transition, not on every subsequent
    // reload of the portal page.
    await prisma.quote.update({
      where: { id: activeId },
      data: { status: "VIEWED", viewedAt: quote.viewedAt ?? new Date() },
    })
    quote.status = "VIEWED"
    quote.viewedAt = quote.viewedAt ?? new Date()
    notifyQuoteEvent(activeId, "QUOTE_VIEWED").catch((err) =>
      console.error("notifyQuoteEvent failed:", err)
    )
  }

  // superseded: a newer version was sent, so the page shows a notice and
  // hides Accept, Decline, and the message box
  return NextResponse.json({ ...toPortalQuote(quote, false), superseded })
}