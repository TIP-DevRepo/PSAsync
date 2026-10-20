import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withoutPortalTokens } from "@/lib/portal-token"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote, quoteWhere } from "@/lib/scoped-loaders"

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
  const companyId = ctx.companyId

  const quote = await loadViewableQuote(ctx, id)
  if (!quote) return notFound()

  const updated = await prisma.$transaction(async (tx) => {
    await tx.quote.updateMany({
      where: { companyId, quoteNumber: quote.quoteNumber, id: { not: id } },
      data: { isActive: false },
    })

    return tx.quote.update({
      where: quoteWhere(ctx, id),
      data: { isActive: true },
    })
  })

  return NextResponse.json(withoutPortalTokens(updated))
}
