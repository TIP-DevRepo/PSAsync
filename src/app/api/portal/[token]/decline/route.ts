import { NextRequest, NextResponse } from "next/server"
import { notifyQuoteEvent } from "@/lib/notify"
import { resolveClientQuoteId } from "@/lib/portal-quote"
import { portalQuoteSelect, toPortalQuote } from "@/lib/portal-public"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))

  const activeId = await resolveClientQuoteId(token)
  if (!activeId) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  const quote = await prisma.quote.findUnique({ where: { id: activeId } })
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }
  if (quote.status === "ACCEPTED" || quote.status === "DECLINED") {
    return NextResponse.json({ error: "This quote has already been responded to" }, { status: 400 })
  }
  if (quote.status === "EXPIRED") {
    return NextResponse.json({ error: "This quote has expired" }, { status: 400 })
  }

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