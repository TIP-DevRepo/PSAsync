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

  const template = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { sections: true },
  })
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  if (template.sections.includes(trimmed)) {
    return NextResponse.json({ sections: template.sections })
  }

  const updated = await prisma.quoteTemplate.update({
    where: { id },
    data: { sections: { set: [...template.sections, trimmed] } },
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

  const template = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { sections: true },
  })
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  const updated = await prisma.quoteTemplate.update({
    where: { id },
    data: { sections: { set: template.sections.filter((s) => s !== name) } },
  })

  return NextResponse.json({ sections: updated.sections })
}