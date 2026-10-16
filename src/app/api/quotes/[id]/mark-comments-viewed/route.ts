import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote, quoteWhere } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const quote = await loadViewableQuote(ctx, id)
  if (!quote) return notFound()

  await prisma.quote.update({
    where: quoteWhere(ctx, id),
    data: { lastCommentViewedAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
