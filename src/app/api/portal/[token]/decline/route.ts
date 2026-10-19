import { NextRequest, NextResponse } from "next/server"
import { notifyQuoteEvent } from "@/lib/notify"
import { linkInvalidResponse, resolvePortalAccess } from "@/lib/portal-access"
import { portalQuoteSelect, toPortalQuote } from "@/lib/portal-public"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  // Only while the quote is waiting on the customer (SENT or VIEWED) and
  // not expired; anything else is refused here
  const access = await resolvePortalAccess(token, "act")
  if (!access.ok) return access.response

  const body = await req.json().catch(() => ({}))

  const quote = await prisma.quote.findUnique({ where: { id: access.quoteId } })
  if (!quote) return linkInvalidResponse()

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: "DECLINED",
      declinedAt: new Date(),
      declineReason: body.reason || null,
    },
    select: portalQuoteSelect,
  })

  notifyQuoteEvent(quote.id, "QUOTE_LOST").catch((err) =>
    console.error("notifyQuoteEvent failed:", err)
  )

  return NextResponse.json(toPortalQuote(updated, false))
}