import { NextRequest, NextResponse } from "next/server"
import { notifyQuoteEvent } from "@/lib/notify"
import { resolvePortalToken } from "@/lib/portal-quote"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const resolved = await resolvePortalToken(token)
  if (!resolved) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }
  const { quoteId: activeId, isInternal } = resolved

  const quote = await prisma.quote.findUnique({
    where: { id: activeId },
    include: {
      client: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true } },
      user: { select: { name: true, email: true } },
      company: {
        select: {
          name: true,
          logoUrl: true,
          secondaryLogoUrl: true,
          settings: { select: { primaryColor: true, accentColor: true } },
        },
      },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  })

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  // None of the auto-status-transition logic below should ever apply to an
  // internal preview — viewing a draft internally must never mark it
  // "viewed" or auto-expire it the way a real client visit would
  if (isInternal) {
    return NextResponse.json({ ...quote, isInternalPreview: true })
  }

  // Auto-expire if past the expiry date and still in an open state
  const isExpired =
    quote.expiresAt &&
    quote.expiresAt < new Date() &&
    !["ACCEPTED", "DECLINED"].includes(quote.status)

  if (isExpired && quote.status !== "EXPIRED") {
    await prisma.quote.update({
      where: { id: quote.id },
      data: { status: "EXPIRED" },
    })
    quote.status = "EXPIRED"
  } else if (quote.status === "SENT") {
    // First time the client opens it — mark as viewed and notify the rep.
    // Only fires on this SENT -> VIEWED transition, not on every subsequent
    // reload of the portal page.
    await prisma.quote.update({
      where: { id: quote.id },
      data: { status: "VIEWED", viewedAt: quote.viewedAt ?? new Date() },
    })
    quote.status = "VIEWED"
    quote.viewedAt = quote.viewedAt ?? new Date()
    notifyQuoteEvent(quote.id, "QUOTE_VIEWED").catch((err) =>
      console.error("notifyQuoteEvent failed:", err)
    )
  }

  return NextResponse.json({ ...quote, isInternalPreview: false })
}