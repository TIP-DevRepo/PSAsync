import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withoutPortalTokens } from "@/lib/portal-token"
import { notFound, requireAccess } from "@/lib/api-access"
import { quoteWhere, viewableQuoteWhere } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.edit",
    message: "You do not have permission to edit quotes",
  })
  if (response) return response

  const { id } = await params
  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    select: { flagged: true },
  })
  if (!quote) return notFound()

  const updated = await prisma.quote.update({
    where: quoteWhere(ctx, id),
    data: { flagged: !quote.flagged },
  })

  return NextResponse.json(withoutPortalTokens(updated))
}
