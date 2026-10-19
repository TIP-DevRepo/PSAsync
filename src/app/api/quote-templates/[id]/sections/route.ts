import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"

// Templates are maintained from Quote Settings
const TEMPLATE_WRITE_RULE = {
  settingsSection: "quotes",
  message: "You do not have permission to edit quote templates",
} as const

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess(TEMPLATE_WRITE_RULE)
  if (response) return response

  const { id } = await params
  const { name } = await req.json()
  const trimmed = (name ?? "").trim()

  if (!trimmed) {
    return NextResponse.json({ error: "Section name can't be blank" }, { status: 400 })
  }

  const template = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: ctx.companyId },
    select: { sections: true },
  })
  if (!template) return notFound()

  if (template.sections.includes(trimmed)) {
    return NextResponse.json({ sections: template.sections })
  }

  const updated = await prisma.quoteTemplate.update({
    where: { id, companyId: ctx.companyId },
    data: { sections: { set: [...template.sections, trimmed] } },
  })

  return NextResponse.json({ sections: updated.sections })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess(TEMPLATE_WRITE_RULE)
  if (response) return response

  const { id } = await params
  const { name } = await req.json()

  const template = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: ctx.companyId },
    select: { sections: true },
  })
  if (!template) return notFound()

  const updated = await prisma.quoteTemplate.update({
    where: { id, companyId: ctx.companyId },
    data: { sections: { set: template.sections.filter((s) => s !== name) } },
  })

  return NextResponse.json({ sections: updated.sections })
}