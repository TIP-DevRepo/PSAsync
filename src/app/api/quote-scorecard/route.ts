import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { quoteListWhere } from "@/lib/scoped-loaders"

export async function GET() {
  const { ctx, response } = await requireAccess({ page: "quotes", message: "You do not have permission to view quotes" })
  if (response) return response

  // Totals cover the quotes this user may open: their own plus ones waiting
  // on their approval, or every quote with quotes.viewAllUsersQuotes
  const quotes = await prisma.quote.findMany({
    where: { ...quoteListWhere(ctx), isActive: true },
    include: {
      lineItems: { select: { unitPrice: true, quantity: true, discount: true } },
    },
  })

  const counts: Record<string, number> = {
    DRAFT: 0,
    PENDING_APPROVAL: 0,
    SENT: 0,
    VIEWED: 0,
    ACCEPTED: 0,
    DECLINED: 0,
    EXPIRED: 0,
  }

  let totalValue = 0
  let acceptedValue = 0

  for (const q of quotes) {
    counts[q.status] = (counts[q.status] ?? 0) + 1

    const quoteTotal = q.lineItems.reduce((sum, li) => {
      return sum + li.unitPrice * li.quantity * (1 - li.discount / 100)
    }, 0)

    totalValue += quoteTotal
    if (q.status === "ACCEPTED") acceptedValue += quoteTotal
  }

  return NextResponse.json({
    totalQuotes: quotes.length,
    counts,
    totalValue,
    acceptedValue,
  })
}