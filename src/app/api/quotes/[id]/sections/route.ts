import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { quoteWhere, viewableQuoteWhere } from "@/lib/scoped-loaders"

const EDIT_RULE = { permission: "quotes.edit", message: "You do not have permission to edit quotes" }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess(EDIT_RULE)
  if (response) return response

  const { id } = await params
  const { name } = await req.json()
  const trimmed = (name ?? "").trim()

  if (!trimmed) {
    return NextResponse.json({ error: "Section name can't be blank" }, { status: 400 })
  }

  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    select: { sections: true },
  })
  if (!quote) return notFound()

  if (quote.sections.includes(trimmed)) {
    return NextResponse.json({ sections: quote.sections })
  }

  const updated = await prisma.quote.update({
    where: quoteWhere(ctx, id),
    data: { sections: { set: [...quote.sections, trimmed] } },
  })

  return NextResponse.json({ sections: updated.sections })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess(EDIT_RULE)
  if (response) return response

  const { id } = await params
  const { name } = await req.json()

  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    select: { sections: true },
  })
  if (!quote) return notFound()

  const updated = await prisma.quote.update({
    where: quoteWhere(ctx, id),
    data: { sections: { set: quote.sections.filter((s) => s !== name) } },
  })

  return NextResponse.json({ sections: updated.sections })
}
