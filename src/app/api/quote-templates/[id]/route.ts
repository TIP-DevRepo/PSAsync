import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const template = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: session.user.companyId },
    include: { lineItems: { include: { catalogItem: true } } },
  })

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  return NextResponse.json(template)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: session.user.companyId },
  })
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  const body = await req.json()

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description || null
  if (body.introText !== undefined) data.introText = body.introText || null
  if (body.terms !== undefined) data.terms = body.terms || null
  if (body.useDefaultTerms !== undefined) data.useDefaultTerms = Boolean(body.useDefaultTerms)
  if (body.expiryDays !== undefined) data.expiryDays = Number(body.expiryDays) || 30
  if (body.active !== undefined) data.active = Boolean(body.active)

  const template = await prisma.quoteTemplate.update({ where: { id }, data })

  return NextResponse.json(template)
}