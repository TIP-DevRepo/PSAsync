import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canSeeCost, notFound, omitCost, requireAccess } from "@/lib/api-access"
import { termsForStorage } from "@/lib/sanitize-terms"

// Templates are maintained from Quote Settings
const TEMPLATE_WRITE_RULE = {
  settingsSection: "quotes",
  message: "You do not have permission to edit quote templates",
} as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({ page: "quotes", message: "You do not have permission to view quotes" })
  if (response) return response

  const { id } = await params

  const template = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: ctx.companyId },
    include: { lineItems: { include: { catalogItem: true } } },
  })

  if (!template) return notFound()

  if (!canSeeCost(ctx)) {
    return NextResponse.json({
      ...template,
      lineItems: template.lineItems.map((li) => ({
        ...omitCost(li),
        catalogItem: li.catalogItem ? omitCost(li.catalogItem) : null,
      })),
    })
  }

  return NextResponse.json(template)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess(TEMPLATE_WRITE_RULE)
  if (response) return response

  const { id } = await params
  const existing = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: ctx.companyId },
  })
  if (!existing) return notFound()

  const body = await req.json()

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description || null
  if (body.introText !== undefined) data.introText = body.introText || null
  if (body.terms !== undefined) data.terms = termsForStorage(body.terms)
  if (body.useDefaultTerms !== undefined) data.useDefaultTerms = Boolean(body.useDefaultTerms)
  if (body.expiryDays !== undefined) data.expiryDays = Number(body.expiryDays) || 30
  if (body.active !== undefined) data.active = Boolean(body.active)

  const template = await prisma.quoteTemplate.update({ where: { id, companyId: ctx.companyId }, data })

  return NextResponse.json(template)
}