import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const { name } = await req.json()
  const trimmed = (name ?? "").trim()

  if (!trimmed) {
    return NextResponse.json({ error: "Section name can't be blank" }, { status: 400 })
  }

  const quote = await prisma.quote.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { sections: true },
  })
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  if (quote.sections.includes(trimmed)) {
    return NextResponse.json({ sections: quote.sections })
  }

  const updated = await prisma.quote.update({
    where: { id },
    data: { sections: { set: [...quote.sections, trimmed] } },
  })

  return NextResponse.json({ sections: updated.sections })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const { name } = await req.json()

  const quote = await prisma.quote.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { sections: true },
  })
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  const updated = await prisma.quote.update({
    where: { id },
    data: { sections: { set: quote.sections.filter((s) => s !== name) } },
  })

  return NextResponse.json({ sections: updated.sections })
}