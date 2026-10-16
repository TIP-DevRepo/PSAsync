import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, loadViewableQuote, quoteWhere } from "@/lib/scoped-loaders"

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
  const body = await req.json()

  if (!body.userId) {
    return NextResponse.json({ error: "A user is required" }, { status: 400 })
  }

  const quote = await loadViewableQuote(ctx, id)
  if (!quote) return notFound()

  // The new owner must be an active user of this company
  const invalid = await assertRefs(ctx, { userId: body.userId })
  if (invalid) return invalid

  const updated = await prisma.quote.update({
    where: quoteWhere(ctx, id),
    data: { userId: body.userId },
  })

  return NextResponse.json(updated)
}
