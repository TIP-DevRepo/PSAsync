import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { portalQuoteSelect, toPortalQuote } from "@/lib/portal-public"

async function resolveActiveQuoteId(token: string) {
  const matched = await prisma.quote.findUnique({
    where: { accessToken: token },
    select: { id: true, companyId: true, quoteNumber: true, isActive: true },
  })
  if (!matched) return null
  if (matched.isActive) return matched.id

  const active = await prisma.quote.findFirst({
    where: { companyId: matched.companyId, quoteNumber: matched.quoteNumber, isActive: true },
    select: { id: true },
  })
  return active?.id ?? matched.id
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))

  if (!body.comment || !body.comment.trim()) {
    return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 })
  }

  const activeId = await resolveActiveQuoteId(token)
  if (!activeId) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  const updated = await prisma.quote.update({
    where: { id: activeId },
    data: {
      portalComment: body.comment,
      portalCommentAt: new Date(),
    },
    select: portalQuoteSelect,
  })

  return NextResponse.json(toPortalQuote(updated, false))
}